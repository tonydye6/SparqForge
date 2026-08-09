/**
 * B1: Shared budget reservation helper — single source of truth for the
 * advisory-lock-based daily-spend gate used across all generation routes
 * (sessions, generate, video).  Callers use the same lock key (100001) and
 * the same cost_logs SUM, so concurrent turn + /generate requests are fully
 * serialized against the same limit.
 */

import { db, costLogsTable, appSettingsTable } from "@workspace/db";
import { and, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import { buildCostRow } from "../services/cost-recording.js";

const BUDGET_LOCK_KEY = 100001;

export type BudgetResult =
  | { ok: true; reservationId: string | null }
  | { ok: false; todaySpend: number; threshold: number };

/**
 * Attempt to reserve `estimatedCost` against today's daily budget.
 *
 * - If no threshold is configured, returns `{ ok: true, reservationId: null }` (no-op).
 * - If the reservation would exceed the threshold, returns `{ ok: false }`.
 * - On success, inserts a `budget_reservation` cost_logs row and returns its id.
 *   The caller MUST settle the reservation (delete the row) in the same
 *   transaction as the real cost_logs row, or eagerly on the error path, to
 *   prevent phantom rows from accumulating.
 */
export async function reserveBudget(
  creativeId: string,
  estimatedCost: number,
  /**
   * M2. Optional so no existing caller had to change. Worth carrying even
   * though a reservation is transient: the known failure mode here is a hold
   * that never settles, and a leaked row with no attribution is a charge
   * against the daily cap that nobody can trace back to a brand.
   */
  brandId?: string | null,
): Promise<BudgetResult> {
  const [thresholdRow] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "dailyCostThreshold"));
  const budgetThreshold = thresholdRow ? parseFloat(thresholdRow.value) : null;
  if (budgetThreshold === null || isNaN(budgetThreshold) || budgetThreshold <= 0) {
    return { ok: true, reservationId: null };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const reservationId = crypto.randomUUID();

  const result = await db.transaction(async (tx) => {
    // Serialize all budget checks under the same advisory lock so a concurrent
    // copilot turn + /generate cannot jointly exceed the daily threshold.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BUDGET_LOCK_KEY})`);
    const [todayResult] = await tx
      .select({ totalCost: sql<number>`COALESCE(SUM(${costLogsTable.costUsd}), 0)` })
      .from(costLogsTable)
      .where(gte(costLogsTable.createdAt, todayStart));
    const currentSpend = Number(todayResult?.totalCost || 0);
    if (currentSpend + estimatedCost > budgetThreshold) {
      return { exceeded: true as const, todaySpend: currentSpend };
    }
    await tx.insert(costLogsTable).values({
      id: reservationId,
      ...buildCostRow({
        creativeId,
        brandId,
        service: "system",
        operation: "budget_reservation",
        model: null,
        costUsd: estimatedCost,
      }),
    });
    return { exceeded: false as const, todaySpend: currentSpend };
  });

  if (result.exceeded) {
    return { ok: false, todaySpend: result.todaySpend, threshold: budgetThreshold };
  }
  return { ok: true, reservationId };
}

/**
 * Standard 429 response body returned when the daily budget is exceeded.
 * All callers must use this helper so the `message` key is always present
 * (the SSE client in CopilotStudio surfaces it on a generic error toast).
 */
export function budgetExceededBody(todaySpend: number, threshold: number) {
  return {
    error: "Daily budget exceeded",
    todaySpend,
    threshold,
    message:
      `Today's spend ($${todaySpend.toFixed(2)}) has reached the daily budget limit ` +
      `($${threshold.toFixed(2)}). Increase the limit in Cost Dashboard settings or wait until tomorrow.`,
  };
}

/**
 * The monthly SOFT cap key. Phase 7 item 5.
 *
 * `monthlyCostThreshold` was already in the settings allowlist and had no reader
 * anywhere — a number the product accepted, stored, and never consulted. Stored
 * in dollars, matching `dailyCostThreshold`.
 *
 * Deliberately NOT the same key as `dailyCostThreshold`. That one is enforced by
 * `reserveBudget` above and REFUSES spend; this one only warns. Collapsing them
 * would silently turn a warning into a hard gate.
 */
export const MONTHLY_BUDGET_KEY = "monthlyCostThreshold";

export interface MonthToDate {
  /** Spend so far this calendar month, holds excluded. */
  spentUsd: number;
  /** The soft cap in dollars, or null when unset. */
  budgetUsd: number | null;
  monthStart: Date;
}

/**
 * Month-to-date spend and the soft cap, for anything that wants to warn before
 * spending. Lives here rather than in the route so the Cost surface and the
 * composer cannot drift on what "this month" or "the cap" means.
 *
 * Holds are excluded on BOTH columns, matching the Cost surface: a reservation
 * is deleted on settle, so counting it would make a spread look twice as
 * expensive the moment it started. (`reserveBudget` deliberately does count
 * them — that gate needs to see in-flight spend. Same rows, two honest
 * readings.)
 */
export async function monthToDateBudget(): Promise<MonthToDate> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${costLogsTable.costUsd}), 0)` })
    .from(costLogsTable)
    .where(
      and(
        gte(costLogsTable.createdAt, monthStart),
        ne(costLogsTable.operation, "budget_reservation"),
        or(
          isNull(costLogsTable.pricingBasis),
          ne(costLogsTable.pricingBasis, "reservation"),
        ),
      ),
    );

  const [setting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, MONTHLY_BUDGET_KEY));
  const dollars = setting ? Number.parseFloat(setting.value) : NaN;

  return {
    spentUsd: Number(row?.total ?? 0),
    // A zero cap means unset, not "ban all spending" — see `budgetStatus`.
    budgetUsd: Number.isFinite(dollars) && dollars > 0 ? dollars : null,
    monthStart,
  };
}
