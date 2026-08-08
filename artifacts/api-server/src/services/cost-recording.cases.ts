/**
 * Cases for `cost-recording.ts`. Shared by the vitest suite and the tsx-verify
 * script so both prove the same thing, per the pattern every service here uses.
 *
 * The cases that matter most are the REFUSALS: a row must not claim to be
 * measured when the counts are missing, a hold must never be counted as spend,
 * and an unset budget must not render as instantly over.
 */

import type { ClassifyBasisInput, SummarisableRow } from "./cost-recording";
import type { CostPricingBasis } from "@workspace/db/schema";
import {
  budgetStatus,
  buildCostRow,
  classifyPricingBasis,
  isEstimated,
  summariseSpend,
  PRICING_BASIS_LABELS,
} from "./cost-recording.js";

export interface BasisCase {
  name: string;
  input: ClassifyBasisInput;
  expected: CostPricingBasis;
}

export const BASIS_CASES: BasisCase[] = [
  {
    name: "a budget hold is a reservation, whatever the service",
    input: { service: "system", operation: "budget_reservation" },
    expected: "reservation",
  },
  {
    name: "a hold wins over token counts — it is not spend at all",
    input: { service: "claude", operation: "budget_reservation", inputTokens: 900, outputTokens: 200 },
    expected: "reservation",
  },
  {
    name: "an unknown service is flat, never measured by default",
    input: { service: "brand-new-vendor", operation: "whatever" },
    expected: "estimate_flat",
  },
  {
    name: "priced from usage is the ONLY way to be measured",
    input: { service: "claude", operation: "caption", costDerivedFromUsage: true },
    expected: "measured_tokens",
  },
  {
    // The live taste-distillation shape: real counts logged, flat cost written.
    name: "logging real token counts does NOT make a flat cost measured",
    input: { service: "anthropic", operation: "taste_distillation", inputTokens: 1200, outputTokens: 340 },
    expected: "estimate_flat",
  },
  {
    name: "claude without counts is an estimate",
    input: { service: "claude", operation: "caption" },
    expected: "estimate_flat",
  },
  {
    name: "an explicit false is an estimate, not a measurement",
    input: { service: "claude", operation: "caption", costDerivedFromUsage: false, inputTokens: 900, outputTokens: 100 },
    expected: "estimate_flat",
  },
  {
    name: "an image service is flat-rate even with counts present",
    input: { service: "gemini", operation: "explore_spread", inputTokens: 10, outputTokens: 10 },
    expected: "estimate_flat",
  },
  {
    name: "a measured claim still loses to a reservation",
    input: { service: "claude", operation: "budget_reservation", costDerivedFromUsage: true },
    expected: "reservation",
  },
  {
    name: "a measured claim beats the byte-estimate rule for video",
    input: { service: "gemini", operation: "video_generation", costDerivedFromUsage: true },
    expected: "measured_tokens",
  },
  {
    name: "video duration is guessed from buffer size",
    input: { service: "gemini", operation: "video_generation" },
    expected: "estimate_from_bytes",
  },
  {
    name: "converting to video is the same guess",
    input: { service: "gemini", operation: "convert_video" },
    expected: "estimate_from_bytes",
  },
  {
    name: "editing video is the same guess",
    input: { service: "gemini", operation: "edit_video" },
    expected: "estimate_from_bytes",
  },
  {
    name: "an unknown operation falls back to flat, never to measured",
    input: { service: "elevenlabs", operation: "something_new" },
    expected: "estimate_flat",
  },
];

export interface SummaryCase {
  name: string;
  rows: SummarisableRow[];
  expected: {
    totalUsd: number;
    usedUsd: number;
    wastedUsd: number;
    unclassifiedUsd: number;
    estimatedUsd: number;
    hasUnknownBasis: boolean;
  };
}

export const SUMMARY_CASES: SummaryCase[] = [
  {
    name: "no rows is all zeroes, not a crash",
    rows: [],
    expected: {
      totalUsd: 0, usedUsd: 0, wastedUsd: 0,
      unclassifiedUsd: 0, estimatedUsd: 0, hasUnknownBasis: false,
    },
  },
  {
    name: "a reservation is excluded from every figure",
    rows: [{ costUsd: 0.48, pricingBasis: "reservation", wasUsed: null }],
    expected: {
      totalUsd: 0, usedUsd: 0, wastedUsd: 0,
      unclassifiedUsd: 0, estimatedUsd: 0, hasUnknownBasis: false,
    },
  },
  {
    name: "kept and culled takes split into used and wasted",
    rows: [
      { costUsd: 0.06, pricingBasis: "estimate_flat", wasUsed: true },
      { costUsd: 0.06, pricingBasis: "estimate_flat", wasUsed: false },
      { costUsd: 0.06, pricingBasis: "estimate_flat", wasUsed: false },
    ],
    expected: {
      totalUsd: 0.18, usedUsd: 0.06, wastedUsd: 0.12,
      unclassifiedUsd: 0, estimatedUsd: 0.18, hasUnknownBasis: false,
    },
  },
  {
    name: "a null wasUsed is unclassified, NOT used",
    rows: [{ costUsd: 0.06, pricingBasis: "estimate_flat", wasUsed: null }],
    expected: {
      totalUsd: 0.06, usedUsd: 0, wastedUsd: 0,
      unclassifiedUsd: 0.06, estimatedUsd: 0.06, hasUnknownBasis: false,
    },
  },
  {
    name: "measured rows do not count toward the estimated share",
    rows: [
      { costUsd: 0.01, pricingBasis: "measured_tokens", wasUsed: true },
      { costUsd: 0.06, pricingBasis: "estimate_flat", wasUsed: true },
    ],
    expected: {
      totalUsd: 0.07, usedUsd: 0.07, wastedUsd: 0,
      unclassifiedUsd: 0, estimatedUsd: 0.06, hasUnknownBasis: false,
    },
  },
  {
    name: "a pre-M2 row counts as estimated and is flagged as such",
    rows: [{ costUsd: 0.48, pricingBasis: "pre_m2_estimate", wasUsed: null }],
    expected: {
      totalUsd: 0.48, usedUsd: 0, wastedUsd: 0,
      unclassifiedUsd: 0.48, estimatedUsd: 0.48, hasUnknownBasis: false,
    },
  },
  {
    name: "a row with no basis at all sets hasUnknownBasis and is assumed estimated",
    rows: [{ costUsd: 0.5, pricingBasis: null, wasUsed: true }],
    expected: {
      totalUsd: 0.5, usedUsd: 0.5, wastedUsd: 0,
      unclassifiedUsd: 0, estimatedUsd: 0.5, hasUnknownBasis: true,
    },
  },
  {
    name: "float drift is rounded to the numeric(12,4) the column stores",
    rows: [
      { costUsd: 0.1, pricingBasis: "estimate_flat", wasUsed: true },
      { costUsd: 0.2, pricingBasis: "estimate_flat", wasUsed: true },
    ],
    expected: {
      totalUsd: 0.3, usedUsd: 0.3, wastedUsd: 0,
      unclassifiedUsd: 0, estimatedUsd: 0.3, hasUnknownBasis: false,
    },
  },
  {
    name: "a whole culled spread against one kept take, the Phase 7 headline case",
    rows: [
      { costUsd: 0.06, pricingBasis: "estimate_flat", wasUsed: true },
      ...Array.from({ length: 7 }, () => ({
        costUsd: 0.06, pricingBasis: "estimate_flat" as const, wasUsed: false,
      })),
      { costUsd: 0.48, pricingBasis: "reservation" as const, wasUsed: null },
    ],
    expected: {
      totalUsd: 0.48, usedUsd: 0.06, wastedUsd: 0.42,
      unclassifiedUsd: 0, estimatedUsd: 0.48, hasUnknownBasis: false,
    },
  },
];

export interface BudgetCase {
  name: string;
  spentUsd: number;
  budgetCents: number | null | undefined;
  expectedState: "no_budget" | "ok" | "warning" | "over";
  expectedFraction: number | null;
}

export const BUDGET_CASES: BudgetCase[] = [
  {
    name: "no budget set reports no_budget, not over",
    spentUsd: 12, budgetCents: null, expectedState: "no_budget", expectedFraction: null,
  },
  {
    name: "undefined budget behaves the same as null",
    spentUsd: 12, budgetCents: undefined, expectedState: "no_budget", expectedFraction: null,
  },
  {
    name: "a zero budget means unset, NOT instantly over",
    spentUsd: 12, budgetCents: 0, expectedState: "no_budget", expectedFraction: null,
  },
  {
    name: "a negative budget is nonsense and is treated as unset",
    spentUsd: 12, budgetCents: -500, expectedState: "no_budget", expectedFraction: null,
  },
  {
    name: "comfortably under budget is ok",
    spentUsd: 10, budgetCents: 10000, expectedState: "ok", expectedFraction: 0.1,
  },
  {
    name: "just below the warning line is still ok",
    spentUsd: 79, budgetCents: 10000, expectedState: "ok", expectedFraction: 0.79,
  },
  {
    name: "exactly at the warning line warns",
    spentUsd: 80, budgetCents: 10000, expectedState: "warning", expectedFraction: 0.8,
  },
  {
    name: "exactly at the budget is over, not warning",
    spentUsd: 100, budgetCents: 10000, expectedState: "over", expectedFraction: 1,
  },
  {
    name: "over budget reports a fraction above 1 rather than clamping",
    spentUsd: 150, budgetCents: 10000, expectedState: "over", expectedFraction: 1.5,
  },
  {
    name: "spending nothing against a real budget is ok",
    spentUsd: 0, budgetCents: 10000, expectedState: "ok", expectedFraction: 0,
  },
];

export interface CaseResult {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const results: CaseResult[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
}

export async function collectCostRecordingCases(): Promise<CaseResult[]> {
  results.length = 0;

  // ---- how a row describes the way its cost was arrived at ----
  for (const c of BASIS_CASES) {
    const got = classifyPricingBasis(c.input);
    check(`basis · ${c.name}`, got === c.expected, got === c.expected ? undefined : got);
  }

  // ---- estimated vs measured ----
  {
    check("only measured_tokens counts as not-estimated", isEstimated("measured_tokens") === false);
    for (const b of ["estimate_flat", "estimate_from_bytes", "pre_m2_estimate", "reservation"] as const) {
      check(`${b} is an estimate`, isEstimated(b) === true);
    }
    check("a missing basis is treated as an estimate", isEstimated(null) === true);
    check("every basis has wording for the UI", Object.keys(PRICING_BASIS_LABELS).length === 5);
  }

  // ---- the row builder, which is what stops a call site forgetting ----
  {
    const row = buildCostRow({
      service: "gemini", operation: "explore_spread", model: "gemini-3-pro-image",
      costUsd: 0.06, brandId: "b1", creativeId: "c1", passType: "preview", wasUsed: false,
    });
    check("builder classifies basis without being told", row.pricingBasis === "estimate_flat", row.pricingBasis);
    check("builder keeps brand attribution", row.brandId === "b1");
    check("builder keeps the pass type", row.passType === "preview");
    check("builder keeps wasUsed false rather than coercing it", row.wasUsed === false);

    const sparse = buildCostRow({ service: "gemini", operation: "art_direction", costUsd: 0.002 });
    check("an unattributed row is null, not empty string", sparse.brandId === null && sparse.creativeId === null);
    check("wasUsed defaults to null, NOT true", sparse.wasUsed === null, sparse.wasUsed);
    check("passType defaults to null", sparse.passType === null);
    check("model defaults to null", sparse.model === null);

    const logged = buildCostRow({
      service: "anthropic", operation: "taste_distillation", costUsd: 0.01,
      inputTokens: 1200, outputTokens: 340,
    });
    check(
      "builder refuses to call a flat cost measured just because counts were logged",
      logged.pricingBasis === "estimate_flat",
      logged.pricingBasis,
    );
    check("builder still carries the counts through", logged.inputTokens === 1200 && logged.outputTokens === 340);

    const measured = buildCostRow({
      service: "claude", operation: "caption", costUsd: 0.0134,
      costDerivedFromUsage: true, inputTokens: 1200, outputTokens: 340,
    });
    check("builder honours an explicit usage-priced claim", measured.pricingBasis === "measured_tokens", measured.pricingBasis);
  }

  // ---- the rollup the Cost surface reads ----
  for (const c of SUMMARY_CASES) {
    const got = summariseSpend(c.rows);
    const ok =
      got.totalUsd === c.expected.totalUsd &&
      got.usedUsd === c.expected.usedUsd &&
      got.wastedUsd === c.expected.wastedUsd &&
      got.unclassifiedUsd === c.expected.unclassifiedUsd &&
      got.estimatedUsd === c.expected.estimatedUsd &&
      got.hasUnknownBasis === c.expected.hasUnknownBasis;
    check(`summary · ${c.name}`, ok, ok ? undefined : got);
  }

  // ---- spend against the soft cap ----
  for (const c of BUDGET_CASES) {
    const got = budgetStatus(c.spentUsd, c.budgetCents);
    const ok = got.state === c.expectedState && got.fraction === c.expectedFraction;
    check(`budget · ${c.name}`, ok, ok ? undefined : got);
  }

  return results;
}
