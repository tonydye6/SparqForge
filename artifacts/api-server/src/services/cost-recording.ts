/**
 * Phase 7 · M2 · what a cost row has to say about itself.
 *
 * **The premise this was built on was wrong, and the correction is the design.**
 * Doc 24 §7 said `cost_logs` stores no dollar amount and recomputes at read
 * time, so a vendor price change silently rewrites history. It does not.
 * `cost_usd` is `numeric(12,4) NOT NULL`, written at spend time, and every read
 * path — the Cost surface, the daily budget check, the monthly archival rollup
 * — sums the stored column. History is frozen.
 *
 * The real defect is subtler and this file is the fix: **the number is frozen
 * at a GUESS, and the row could not say so.** Imagen is a flat $0.06 whatever
 * the model or resolution; video duration is `bufferBytes / 512_000`, a
 * compressed-bitrate guess; captions are a flat $0.01 even though
 * `input_tokens` / `output_tokens` exist to do better. Exactly one of roughly
 * twenty writers ever recorded real usage. A column of estimates that reads as
 * a column of measurements is the §2.9 problem, and the one-line test in doc 24
 * §8 — does this make the collaboration more visible — says the row must
 * disclose its own basis.
 *
 * So `pricingBasis` is not decoration. It is what lets the Cost surface say
 * "estimated" out loud instead of implying a precision nobody paid for.
 *
 * The second thing M2 fixes is attribution. `cost_logs.creative_id` is
 * `ON DELETE SET NULL`, so **deleting a creative silently orphaned every cost
 * row it caused** — the money stayed in the totals with nothing to attribute it
 * to. Verified on a real row, not reasoned about. `brandId` is written at spend
 * time so attribution survives the creative.
 *
 * Pure: no DB, no clock, no model call. Callers pass what they know.
 */

import type { CostPassType, CostPricingBasis } from "@workspace/db/schema";

/**
 * Operations that are a budget HOLD rather than spend. The reservation row is
 * inserted before the vendor call and deleted when the turn settles, so it must
 * never be counted as money spent — but while it exists it has to be summable,
 * because that is how the daily cap stays honest under concurrency.
 */
const RESERVATION_OPERATIONS = new Set(["budget_reservation"]);

/**
 * Operations priced off a guessed duration rather than a per-call constant.
 * Video is the only one today: the vendor does not return a duration, so it is
 * inferred from the compressed buffer size.
 */
const BYTE_ESTIMATED_OPERATIONS = new Set([
  "video_generation",
  "convert_video",
  "edit_video",
]);

export interface ClassifyBasisInput {
  service: string;
  operation: string;
  /**
   * Set ONLY when `costUsd` was actually computed from vendor usage figures
   * multiplied by a per-token rate.
   *
   * **This is deliberately not inferred from the presence of `inputTokens` /
   * `outputTokens`, and that distinction is the whole point of the column.**
   * `taste-distillation` records real token counts and then writes a flat
   * `estimateClaudeCost()` anyway — so counts being present says we logged
   * usage, not that we priced from it. Inferring "measured" there would stamp a
   * guess as a measurement in the one place built to stop that.
   *
   * No caller can honestly pass this today: every writer uses a flat constant
   * or a byte-size guess. That is the true state of the billing data, and the
   * Cost surface should say so rather than flatter it.
   */
  costDerivedFromUsage?: boolean;
  /** Real usage from the vendor response, when it came back. Recorded, not priced from. */
  inputTokens?: number | null;
  outputTokens?: number | null;
}

/**
 * Decide what a row may honestly claim about how its cost was arrived at.
 *
 * The ordering is deliberate. Reservation wins first because a hold is not
 * spend at all, and mislabelling it would corrupt the one aggregate that gates
 * real money.
 */
export function classifyPricingBasis(input: ClassifyBasisInput): CostPricingBasis {
  if (RESERVATION_OPERATIONS.has(input.operation)) return "reservation";
  if (input.costDerivedFromUsage === true) return "measured_tokens";
  if (BYTE_ESTIMATED_OPERATIONS.has(input.operation)) return "estimate_from_bytes";
  return "estimate_flat";
}

/** True when a basis means "this number is a guess", for the UI to say so. */
export function isEstimated(basis: CostPricingBasis | null | undefined): boolean {
  return basis !== "measured_tokens";
}

/**
 * Human wording for a basis. Kept here rather than in the client so the Cost
 * surface and any future export describe a row the same way.
 */
export const PRICING_BASIS_LABELS: Record<CostPricingBasis, string> = {
  measured_tokens: "Measured from token usage",
  estimate_flat: "Estimated at a flat per-call rate",
  estimate_from_bytes: "Estimated from clip size",
  reservation: "Budget hold, not spend",
  pre_m2_estimate: "Estimated — basis not recorded",
};

export interface CostRowInput {
  service: string;
  operation: string;
  model?: string | null;
  costUsd: number;
  brandId?: string | null;
  creativeId?: string | null;
  /** See `ClassifyBasisInput.costDerivedFromUsage` — priced from usage, not merely logged with it. */
  costDerivedFromUsage?: boolean;
  passType?: CostPassType | null;
  /**
   * Whether the thing this paid for was kept. Left undefined outside a two-pass
   * flow: NULL means "not part of one", which is NOT the same as unused, and
   * defaulting it to true would quietly hide every culled take from the waste
   * total that Phase 7 exists to show.
   */
  wasUsed?: boolean | null;
  /**
   * The take this money bought. Phase 7 item 2.
   *
   * Set it wherever one call produces one take. Without it a spread logs one row
   * for eight images and `wasUsed` has to describe all eight at once, which it
   * cannot do honestly.
   */
  stageTakeId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface CostRow {
  service: string;
  operation: string;
  model: string | null;
  costUsd: number;
  brandId: string | null;
  creativeId: string | null;
  pricingBasis: CostPricingBasis;
  passType: CostPassType | null;
  wasUsed: boolean | null;
  stageTakeId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Build the row every `cost_logs` insert should use, so basis and attribution
 * cannot be forgotten at one of the ~20 call sites.
 */
export function buildCostRow(input: CostRowInput): CostRow {
  return {
    service: input.service,
    operation: input.operation,
    model: input.model ?? null,
    costUsd: input.costUsd,
    brandId: input.brandId ?? null,
    creativeId: input.creativeId ?? null,
    pricingBasis: classifyPricingBasis(input),
    passType: input.passType ?? null,
    wasUsed: input.wasUsed ?? null,
    stageTakeId: input.stageTakeId ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
  };
}

export interface SpendBucket {
  /** Money actually spent and kept. */
  usedUsd: number;
  /** Money spent on takes that were culled and never published. */
  wastedUsd: number;
  /**
   * Spend not part of a two-pass flow, so neither kept nor wasted. Reported
   * separately rather than folded into `usedUsd`, because calling it "used"
   * would overstate how much of the bill we can actually account for.
   */
  unclassifiedUsd: number;
}

export interface SpendSummary extends SpendBucket {
  totalUsd: number;
  /** Share of the total whose cost is an estimate rather than a measurement. */
  estimatedUsd: number;
  /** True when any row in the set could not state its basis. */
  hasUnknownBasis: boolean;
}

export interface SummarisableRow {
  costUsd: number;
  pricingBasis?: CostPricingBasis | null;
  wasUsed?: boolean | null;
}

/**
 * Roll rows up for the Cost surface.
 *
 * **Reservations are excluded from every figure.** They are holds that will be
 * deleted on settle, and including them would double-count a spread the moment
 * it succeeded. The daily budget check deliberately does the opposite — it must
 * count holds — which is why that sum lives in `budget.ts` and not here.
 */
export function summariseSpend(rows: readonly SummarisableRow[]): SpendSummary {
  const summary: SpendSummary = {
    totalUsd: 0,
    usedUsd: 0,
    wastedUsd: 0,
    unclassifiedUsd: 0,
    estimatedUsd: 0,
    hasUnknownBasis: false,
  };

  for (const row of rows) {
    if (row.pricingBasis === "reservation") continue;

    const amount = row.costUsd;
    summary.totalUsd += amount;

    if (row.wasUsed === true) summary.usedUsd += amount;
    else if (row.wasUsed === false) summary.wastedUsd += amount;
    else summary.unclassifiedUsd += amount;

    if (!row.pricingBasis) {
      summary.hasUnknownBasis = true;
      summary.estimatedUsd += amount;
    } else if (isEstimated(row.pricingBasis)) {
      summary.estimatedUsd += amount;
    }
  }

  return round(summary);
}

/**
 * Fixed to four decimals to match `numeric(12,4)`. Float addition over many
 * rows drifts, and a Cost surface that disagrees with the database by a
 * fraction of a cent invites exactly the doubt this phase is meant to remove.
 */
function round(summary: SpendSummary): SpendSummary {
  const fix = (n: number) => Number(n.toFixed(4));
  return {
    totalUsd: fix(summary.totalUsd),
    usedUsd: fix(summary.usedUsd),
    wastedUsd: fix(summary.wastedUsd),
    unclassifiedUsd: fix(summary.unclassifiedUsd),
    estimatedUsd: fix(summary.estimatedUsd),
    hasUnknownBasis: summary.hasUnknownBasis,
  };
}

export interface BudgetStatus {
  spentUsd: number;
  budgetUsd: number | null;
  /** 0-1, or null when no budget is set. Not clamped: over-budget must show. */
  fraction: number | null;
  state: "no_budget" | "ok" | "warning" | "over";
}

/** Fraction of a monthly budget at which the surface starts warning. */
export const BUDGET_WARNING_FRACTION = 0.8;

/**
 * Where this month's spend sits against the soft cap.
 *
 * A monthly budget of zero is treated as **no budget**, not as "instantly over".
 * `monthlyBudgetCents` is nullable and a zero almost always means unset rather
 * than a deliberate ban on all spending; rendering a permanent red over-budget
 * bar for an unconfigured brand would train people to ignore the colour.
 */
export function budgetStatus(spentUsd: number, monthlyBudgetCents: number | null | undefined): BudgetStatus {
  if (monthlyBudgetCents === null || monthlyBudgetCents === undefined || monthlyBudgetCents <= 0) {
    return { spentUsd: Number(spentUsd.toFixed(4)), budgetUsd: null, fraction: null, state: "no_budget" };
  }

  const budgetUsd = monthlyBudgetCents / 100;
  const fraction = spentUsd / budgetUsd;

  return {
    spentUsd: Number(spentUsd.toFixed(4)),
    budgetUsd: Number(budgetUsd.toFixed(4)),
    fraction: Number(fraction.toFixed(4)),
    state: fraction >= 1 ? "over" : fraction >= BUDGET_WARNING_FRACTION ? "warning" : "ok",
  };
}
