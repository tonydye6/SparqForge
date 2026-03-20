import { Router, type IRouter } from "express";
import { eq, desc, gte, lte, and, sql } from "drizzle-orm";
import { db, costLogsTable } from "@workspace/db";

const router: IRouter = Router();

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

  const conditions = [];
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

  const conditions = [];
  const parsedStart = parseValidDate(startDate);
  const parsedEnd = parseValidDate(endDate);
  if (parsedStart) {
    conditions.push(gte(costLogsTable.createdAt, parsedStart));
  }
  if (parsedEnd) {
    conditions.push(lte(costLogsTable.createdAt, parsedEnd));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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

  res.json({
    totalCost: Number(totalResult[0]?.totalCost || 0),
    totalEntries: Number(totalResult[0]?.totalEntries || 0),
    byService: byService.map(s => ({ service: s.service, totalCost: Number(s.totalCost), count: Number(s.count) })),
    byOperation: byOperation.map(o => ({ operation: o.operation, service: o.service, totalCost: Number(o.totalCost), count: Number(o.count) })),
    dailySpend: dailySpend.map(d => ({ date: d.date, totalCost: Number(d.totalCost), count: Number(d.count) })),
  });
});

export default router;
