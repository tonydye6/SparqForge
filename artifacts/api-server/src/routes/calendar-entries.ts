import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, calendarEntriesTable, campaignsTable, campaignVariantsTable, brandsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/calendar-entries", async (req, res): Promise<void> => {
  const { start, end, brandId } = req.query as Record<string, string>;

  let query = db
    .select({
      id: calendarEntriesTable.id,
      campaignId: calendarEntriesTable.campaignId,
      variantId: calendarEntriesTable.variantId,
      platform: calendarEntriesTable.platform,
      scheduledAt: calendarEntriesTable.scheduledAt,
      publishedAt: calendarEntriesTable.publishedAt,
      publishStatus: calendarEntriesTable.publishStatus,
      campaignName: campaignsTable.name,
      brandId: campaignsTable.brandId,
      brandName: brandsTable.name,
      brandColor: brandsTable.colorPrimary,
      caption: campaignVariantsTable.caption,
      aspectRatio: campaignVariantsTable.aspectRatio,
    })
    .from(calendarEntriesTable)
    .innerJoin(campaignsTable, eq(calendarEntriesTable.campaignId, campaignsTable.id))
    .innerJoin(brandsTable, eq(campaignsTable.brandId, brandsTable.id))
    .innerJoin(campaignVariantsTable, eq(calendarEntriesTable.variantId, campaignVariantsTable.id))
    .$dynamic();

  const conditions = [];
  if (start) conditions.push(gte(calendarEntriesTable.scheduledAt, new Date(start)));
  if (end) conditions.push(lte(calendarEntriesTable.scheduledAt, new Date(end)));
  if (brandId) conditions.push(eq(campaignsTable.brandId, brandId));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const entries = await query.orderBy(calendarEntriesTable.scheduledAt);
  res.json(entries);
});

router.post("/calendar-entries", async (req, res): Promise<void> => {
  const { campaignId, variantId, platform, scheduledAt, socialAccountId } = req.body;

  if (!campaignId || !variantId || !platform || !scheduledAt) {
    res.status(400).json({ error: "Missing required fields: campaignId, variantId, platform, scheduledAt" });
    return;
  }

  const [entry] = await db.insert(calendarEntriesTable).values({
    campaignId,
    variantId,
    platform,
    scheduledAt: new Date(scheduledAt),
    socialAccountId: socialAccountId || null,
  }).returning();

  res.status(201).json(entry);
});

router.put("/calendar-entries/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const updates: Record<string, unknown> = {};

  if (req.body.scheduledAt) updates.scheduledAt = new Date(req.body.scheduledAt);
  if (req.body.publishStatus) updates.publishStatus = req.body.publishStatus;
  if (req.body.socialAccountId !== undefined) updates.socialAccountId = req.body.socialAccountId;

  updates.updatedAt = new Date();

  const [entry] = await db
    .update(calendarEntriesTable)
    .set(updates)
    .where(eq(calendarEntriesTable.id, id as string))
    .returning();

  if (!entry) {
    res.status(404).json({ error: "Calendar entry not found" });
    return;
  }

  res.json(entry);
});

router.delete("/calendar-entries/:id", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [entry] = await db
    .delete(calendarEntriesTable)
    .where(eq(calendarEntriesTable.id, id as string))
    .returning();

  if (!entry) {
    res.status(404).json({ error: "Calendar entry not found" });
    return;
  }

  res.json({ message: "Calendar entry deleted" });
});

export default router;
