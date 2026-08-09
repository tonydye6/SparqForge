import { Router, type IRouter } from "express";
import { eq, desc, gte, lte, and, ne, or, isNull, sql } from "drizzle-orm";
import { db, appSettingsTable, costLogsTable, costLogMonthlySummaryTable } from "@workspace/db";
import { budgetStatus, summariseSpend, BUDGET_WARNING_FRACTION } from "../services/cost-recording.js";
import { monthToDateBudget } from "../lib/budget.js";



const router: IRouter = Router();

/**
 * Budget reservations are HOLDS, not spend.
 *
 * A reservation row is inserted before a vendor call and deleted when the turn
 * settles, purely so the daily cap stays correct under concurrency. Every
 * aggregate on this route summed them anyway, so the dashboard overstated spend
 * by the value of each in-flight hold and counted it as an "API call" under a
 * service literally named "system". Caught by walking the surface with data in
 * it — the empty dashboard looked perfectly fine.
 *
 * Filtered on BOTH columns deliberately. `pricing_basis` is the M2 answer and
 * covers backfilled history, but `operation` is the ground truth that predates
 * the column, so a row written by some path that bypasses `buildCostRow` still
 * cannot sneak a hold into the totals.
 *
 * The daily budget check in `lib/budget.ts` does the opposite and must: holds
 * are exactly what it needs to count. Same rows, two honest readings.
 */
const EXCLUDE_HOLDS = and(
  or(isNull(costLogsTable.pricingBasis), ne(costLogsTable.pricingBasis, "reservation")),
  ne(costLogsTable.operation, "budget_reservation"),
);

function parseValidDate(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

router.get("/cost-logs", async (req, res): Promise<void> => {
  const { startDate, endDate, service, operation, limit: limitStr } = req.query;

  if (startDate && !parseValidDate(startDate)) {
    res.status(400).json({ error: "Invalid startDate format" });
    return;
  }
  if (endDate && !parseValidDate(endDate)) {
    res.status(400).json({ error: "Invalid endDate format" });
    return;
  }

  const conditions = [EXCLUDE_HOLDS];
  const parsedStart = parseValidDate(startDate);
  const parsedEnd = parseValidDate(endDate);
  if (parsedStart) {
    conditions.push(gte(costLogsTable.createdAt, parsedStart));
  }
  if (parsedEnd) {
    conditions.push(lte(costLogsTable.createdAt, parsedEnd));
  }
  if (service) {
    conditions.push(eq(costLogsTable.service, service as string));
  }
  if (operation) {
    conditions.push(eq(costLogsTable.operation, operation as string));
  }

  const rawLimit = parseInt(limitStr as string);
  const queryLimit = Math.min(Math.max(isNaN(rawLimit) ? 200 : rawLimit, 1), 1000);

  let query = db.select().from(costLogsTable);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const results = await query.orderBy(desc(costLogsTable.createdAt)).limit(queryLimit);
  res.json(results);
});

router.get("/cost-logs/summary", async (req, res): Promise<void> => {
  const { startDate, endDate } = req.query;

  if (startDate && !parseValidDate(startDate)) {
    res.status(400).json({ error: "Invalid startDate format" });
    return;
  }
  if (endDate && !parseValidDate(endDate)) {
    res.status(400).json({ error: "Invalid endDate format" });
    return;
  }

  const conditions = [EXCLUDE_HOLDS];
  const parsedStart = parseValidDate(startDate);
  const parsedEnd = parseValidDate(endDate);
  if (parsedStart) {
    conditions.push(gte(costLogsTable.createdAt, parsedStart));
  }
  if (parsedEnd) {
    conditions.push(lte(costLogsTable.createdAt, parsedEnd));
  }

  const whereClause = and(...conditions);

  // Rows older than the retention window are rolled up into
  // cost_log_monthly_summary (see scripts/src/archive-cost-logs.ts) and removed
  // from cost_logs. Archival is whole-month aligned, so the two tables never
  // cover the same month and can be combined without double counting. We read
  // both here so totals stay correct over the full lifetime, not just the
  // retained window. The summary table is filtered by its `month` column so a
  // date-bounded request only includes archived months within range.
  const summaryConditions = [];
  if (parsedStart) {
    summaryConditions.push(gte(costLogMonthlySummaryTable.month, parsedStart));
  }
  if (parsedEnd) {
    summaryConditions.push(lte(costLogMonthlySummaryTable.month, parsedEnd));
  }
  const summaryWhereClause = summaryConditions.length > 0 ? and(...summaryConditions) : undefined;

  const totalResult = await db.select({
    totalCost: sql<number>`COALESCE(SUM(${costLogsTable.costUsd}), 0)`,
    totalEntries: sql<number>`COUNT(*)`,
  }).from(costLogsTable).where(whereClause);

  const byService = await db.select({
    service: costLogsTable.service,
    totalCost: sql<number>`COALESCE(SUM(${costLogsTable.costUsd}), 0)`,
    count: sql<number>`COUNT(*)`,
  }).from(costLogsTable).where(whereClause).groupBy(costLogsTable.service);

  const byOperation = await db.select({
    operation: costLogsTable.operation,
    service: costLogsTable.service,
    totalCost: sql<number>`COALESCE(SUM(${costLogsTable.costUsd}), 0)`,
    count: sql<number>`COUNT(*)`,
  }).from(costLogsTable).where(whereClause).groupBy(costLogsTable.operation, costLogsTable.service);

  const dailySpend = await db.select({
    date: sql<string>`DATE(${costLogsTable.createdAt})`,
    totalCost: sql<number>`COALESCE(SUM(${costLogsTable.costUsd}), 0)`,
    count: sql<number>`COUNT(*)`,
  }).from(costLogsTable).where(whereClause)
    .groupBy(sql`DATE(${costLogsTable.createdAt})`)
    .orderBy(sql`DATE(${costLogsTable.createdAt})`);

  // Archived (rolled-up) aggregates from the monthly summary table.
  const archivedTotal = await db.select({
    totalCost: sql<number>`COALESCE(SUM(${costLogMonthlySummaryTable.totalCostUsd}), 0)`,
    totalEntries: sql<number>`COALESCE(SUM(${costLogMonthlySummaryTable.entryCount}), 0)`,
  }).from(costLogMonthlySummaryTable).where(summaryWhereClause);

  const archivedByService = await db.select({
    service: costLogMonthlySummaryTable.service,
    totalCost: sql<number>`COALESCE(SUM(${costLogMonthlySummaryTable.totalCostUsd}), 0)`,
    count: sql<number>`COALESCE(SUM(${costLogMonthlySummaryTable.entryCount}), 0)`,
  }).from(costLogMonthlySummaryTable).where(summaryWhereClause).groupBy(costLogMonthlySummaryTable.service);

  const archivedByOperation = await db.select({
    operation: costLogMonthlySummaryTable.operation,
    service: costLogMonthlySummaryTable.service,
    totalCost: sql<number>`COALESCE(SUM(${costLogMonthlySummaryTable.totalCostUsd}), 0)`,
    count: sql<number>`COALESCE(SUM(${costLogMonthlySummaryTable.entryCount}), 0)`,
  }).from(costLogMonthlySummaryTable).where(summaryWhereClause)
    .groupBy(costLogMonthlySummaryTable.operation, costLogMonthlySummaryTable.service);

  // Archived rows only have monthly granularity, so each archived month becomes
  // a single daily-spend bucket dated to the first day of that month.
  const archivedMonthlySpend = await db.select({
    date: sql<string>`TO_CHAR(${costLogMonthlySummaryTable.month}, 'YYYY-MM-DD')`,
    totalCost: sql<number>`COALESCE(SUM(${costLogMonthlySummaryTable.totalCostUsd}), 0)`,
    count: sql<number>`COALESCE(SUM(${costLogMonthlySummaryTable.entryCount}), 0)`,
  }).from(costLogMonthlySummaryTable).where(summaryWhereClause)
    .groupBy(costLogMonthlySummaryTable.month)
    .orderBy(costLogMonthlySummaryTable.month);

  // Merge live + archived aggregates keyed by their grouping columns.
  const serviceMap = new Map<string, { service: string; totalCost: number; count: number }>();
  for (const s of byService) {
    serviceMap.set(s.service, { service: s.service, totalCost: Number(s.totalCost), count: Number(s.count) });
  }
  for (const s of archivedByService) {
    const existing = serviceMap.get(s.service);
    if (existing) {
      existing.totalCost += Number(s.totalCost);
      existing.count += Number(s.count);
    } else {
      serviceMap.set(s.service, { service: s.service, totalCost: Number(s.totalCost), count: Number(s.count) });
    }
  }

  const operationMap = new Map<string, { operation: string; service: string; totalCost: number; count: number }>();
  for (const o of byOperation) {
    operationMap.set(`${o.service}::${o.operation}`, { operation: o.operation, service: o.service, totalCost: Number(o.totalCost), count: Number(o.count) });
  }
  for (const o of archivedByOperation) {
    const key = `${o.service}::${o.operation}`;
    const existing = operationMap.get(key);
    if (existing) {
      existing.totalCost += Number(o.totalCost);
      existing.count += Number(o.count);
    } else {
      operationMap.set(key, { operation: o.operation, service: o.service, totalCost: Number(o.totalCost), count: Number(o.count) });
    }
  }

  const dailyMap = new Map<string, { date: string; totalCost: number; count: number }>();
  for (const d of dailySpend) {
    dailyMap.set(d.date, { date: d.date, totalCost: Number(d.totalCost), count: Number(d.count) });
  }
  for (const d of archivedMonthlySpend) {
    const existing = dailyMap.get(d.date);
    if (existing) {
      existing.totalCost += Number(d.totalCost);
      existing.count += Number(d.count);
    } else {
      dailyMap.set(d.date, { date: d.date, totalCost: Number(d.totalCost), count: Number(d.count) });
    }
  }

  /*
   * Phase 7 item 4 — kept, wasted and unaccounted-for, as three numbers instead
   * of one total.
   *
   * `summariseSpend` has existed since M2 and nothing called it, so the surface
   * could only ever say what was spent, never what it bought. That is the
   * difference between a bill and a decision: doc 24 §8 asks whether a thing
   * makes the collaboration more visible, and a single total hides the one fact
   * a spread's owner can act on.
   *
   * Read from `cost_logs` ONLY, deliberately. The archived monthly rollup keeps
   * no `was_used`, so folding it in would silently reclassify every archived
   * dollar as unaccounted-for and make waste look like it collapses the moment a
   * month ages out. `spendWindow` says which rows the split covers so the
   * surface can be explicit that it is narrower than the total above it.
   */
  const splitRows = await db.select({
    costUsd: costLogsTable.costUsd,
    pricingBasis: costLogsTable.pricingBasis,
    wasUsed: costLogsTable.wasUsed,
  }).from(costLogsTable).where(whereClause);

  /*
   * Phase 7 item 4 — the month against the budget.
   *
   * Deliberately IGNORES the date-range filter above. The surface offers
   * 7d/30d/90d/all, and a monthly budget answered against "last 90 days" would
   * be a different question wearing the same words — the cap resets on the 1st
   * whatever the viewer is looking at.
   *
   * Read through `monthToDateBudget` so this and the composer's pre-turn warning
   * cannot disagree about what "this month" or "the cap" means.
   */
  const mtd = await monthToDateBudget();

  res.json({
    totalCost: Number(totalResult[0]?.totalCost || 0) + Number(archivedTotal[0]?.totalCost || 0),
    totalEntries: Number(totalResult[0]?.totalEntries || 0) + Number(archivedTotal[0]?.totalEntries || 0),
    byService: Array.from(serviceMap.values()),
    byOperation: Array.from(operationMap.values()),
    dailySpend: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    spend: summariseSpend(splitRows),
    /** Calendar month-to-date against the soft cap, independent of the range filter. */
    budget: {
      ...budgetStatus(mtd.spentUsd, mtd.budgetUsd === null ? null : Math.round(mtd.budgetUsd * 100)),
      monthStart: mtd.monthStart.toISOString(),
      warningFraction: BUDGET_WARNING_FRACTION,
    },
    spendWindow: {
      rows: splitRows.length,
      /** True when archived months are in `totalCost` but not in `spend`. */
      excludesArchived: Number(archivedTotal[0]?.totalEntries || 0) > 0,
    },
  });
});

export default router;
