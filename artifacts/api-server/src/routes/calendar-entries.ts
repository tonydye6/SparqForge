import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, calendarEntriesTable, campaignsTable, campaignVariantsTable, brandsTable, socialAccountsTable } from "@workspace/db";
import { publishEntry } from "../services/publish-scheduler";
import { z } from "zod";

const router: IRouter = Router();

router.get("/calendar-entries", async (req, res): Promise<void> => {
  const { start, end, brandId } = req.query as Record<string, string>;

  let query = db
    .select({
      id: calendarEntriesTable.id,
      campaignId: calendarEntriesTable.campaignId,
      variantId: calendarEntriesTable.variantId,
      platform: calendarEntriesTable.platform,
      socialAccountId: calendarEntriesTable.socialAccountId,
      scheduledAt: calendarEntriesTable.scheduledAt,
      publishedAt: calendarEntriesTable.publishedAt,
      publishStatus: calendarEntriesTable.publishStatus,
      publishError: calendarEntriesTable.publishError,
      retryCount: calendarEntriesTable.retryCount,
      campaignName: campaignsTable.name,
      brandId: campaignsTable.brandId,
      brandName: brandsTable.name,
      brandColor: brandsTable.colorPrimary,
      caption: campaignVariantsTable.caption,
      aspectRatio: campaignVariantsTable.aspectRatio,
      compositedImageUrl: campaignVariantsTable.compositedImageUrl,
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

router.post("/calendar-entries/:id/publish", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [entry] = await db.select().from(calendarEntriesTable)
    .where(eq(calendarEntriesTable.id, id as string));

  if (!entry) {
    res.status(404).json({ error: "Calendar entry not found" });
    return;
  }

  if (entry.publishStatus === "published") {
    res.status(400).json({ error: "Entry already published" });
    return;
  }

  if (entry.publishStatus === "publishing") {
    res.status(400).json({ error: "Entry is currently being published" });
    return;
  }

  if (!entry.socialAccountId) {
    res.status(400).json({ error: "No social account connected for this entry" });
    return;
  }

  const [account] = await db.select().from(socialAccountsTable)
    .where(eq(socialAccountsTable.id, entry.socialAccountId));

  if (!account) {
    res.status(400).json({ error: "Connected social account not found" });
    return;
  }

  publishEntry(id).catch(err => {
    console.error("Background publish failed:", err);
  });

  res.json({ message: "Publishing initiated", entryId: id });
});

router.post("/calendar-entries/:id/retry", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [entry] = await db.select().from(calendarEntriesTable)
    .where(eq(calendarEntriesTable.id, id as string));

  if (!entry) {
    res.status(404).json({ error: "Calendar entry not found" });
    return;
  }

  if (entry.publishStatus !== "failed") {
    res.status(400).json({ error: "Only failed entries can be retried" });
    return;
  }

  await db.update(calendarEntriesTable)
    .set({ publishStatus: "scheduled", publishError: null, retryCount: 0, updatedAt: new Date() })
    .where(eq(calendarEntriesTable.id, id as string));

  publishEntry(id).catch(err => {
    console.error("Background retry publish failed:", err);
  });

  res.json({ message: "Retry initiated", entryId: id });
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

const BatchScheduleBodySchema = z.object({
  entries: z.array(
    z.object({
      campaignId: z.string(),
      scheduledAt: z.string(),
      socialAccounts: z.record(z.string(), z.string()).optional(),
    })
  ),
});

router.post("/calendar-entries/batch", async (req, res): Promise<void> => {
  const parseResult = BatchScheduleBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body", details: parseResult.error.issues });
    return;
  }

  const { entries } = parseResult.data;

  // Validate all campaigns exist and are approved
  const campaignIds = entries.map((e) => e.campaignId);
  const campaigns = await db
    .select()
    .from(campaignsTable)
    .where(sql`${campaignsTable.id} = ANY(${campaignIds})`);

  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

  for (const entry of entries) {
    const campaign = campaignMap.get(entry.campaignId);
    if (!campaign) {
      res.status(400).json({ error: `Campaign not found: ${entry.campaignId}` });
      return;
    }
    if (campaign.status !== "approved") {
      res.status(400).json({
        error: `Campaign ${entry.campaignId} is not approved (status: ${campaign.status})`,
      });
      return;
    }
  }

  const created: (typeof calendarEntriesTable.$inferSelect)[] = [];
  const campaignsScheduled: string[] = [];

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const variants = await tx
        .select()
        .from(campaignVariantsTable)
        .where(eq(campaignVariantsTable.campaignId, entry.campaignId));

      for (const variant of variants) {
        const socialAccountId = entry.socialAccounts?.[variant.platform] ?? null;

        const [calEntry] = await tx
          .insert(calendarEntriesTable)
          .values({
            campaignId: entry.campaignId,
            variantId: variant.id,
            platform: variant.platform,
            scheduledAt: new Date(entry.scheduledAt),
            socialAccountId,
          })
          .returning();

        created.push(calEntry);
      }

      await tx
        .update(campaignsTable)
        .set({ status: "scheduled", updatedAt: new Date() })
        .where(eq(campaignsTable.id, entry.campaignId));

      campaignsScheduled.push(entry.campaignId);
    }
  });

  res.status(201).json({ created, campaignsScheduled });
});

export default router;
