import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import { z } from "zod/v4";
import { validateRequest } from "../middleware/validate.js";

const UpdateSettingsBody = z.record(z.string(), z.string());

const router: IRouter = Router();

router.get("/settings", async (_req, res): Promise<void> => {
  const rows = await db.select().from(appSettingsTable);
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

router.put("/settings", validateRequest({ body: UpdateSettingsBody }), async (req, res): Promise<void> => {
  const updates = req.body;

  for (const [key, value] of Object.entries(updates)) {
    if (typeof value !== "string") continue;
    await db
      .insert(appSettingsTable)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value, updatedAt: new Date() },
      });
  }

  const rows = await db.select().from(appSettingsTable);
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

router.get("/settings/daily-budget-status", async (_req, res): Promise<void> => {
  const [thresholdRow] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "dailyCostThreshold"));

  const threshold = thresholdRow ? parseFloat(thresholdRow.value) : null;

  if (threshold === null || isNaN(threshold)) {
    res.json({ threshold: null, todaySpend: 0, remaining: null, overBudget: false });
    return;
  }

  const { sql } = await import("drizzle-orm");
  const { costLogsTable } = await import("@workspace/db");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [result] = await db
    .select({
      totalCost: sql<number>`COALESCE(SUM(${costLogsTable.costUsd}), 0)`,
    })
    .from(costLogsTable)
    .where(sql`${costLogsTable.createdAt} >= ${todayStart}`);

  const todaySpend = Number(result?.totalCost || 0);
  const remaining = threshold - todaySpend;

  res.json({
    threshold,
    todaySpend,
    remaining,
    overBudget: todaySpend >= threshold,
    nearLimit: todaySpend >= threshold * 0.8,
  });
});

export default router;
