import { Router, type IRouter } from "express";
import { eq, and, gte } from "drizzle-orm";
import { db, campaignsTable, campaignVariantsTable, calendarEntriesTable } from "@workspace/db";
import {
  GetCampaignsQueryParams,
  CreateCampaignBody,
  GetCampaignParams,
  GetCampaignsResponse,
  GetCampaignResponse,
  UpdateCampaignParams,
  UpdateCampaignBody,
  UpdateCampaignResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/campaigns", async (req, res): Promise<void> => {
  const query = GetCampaignsQueryParams.safeParse(req.query);
  let results;

  if (query.success && query.data.brandId) {
    results = await db.select().from(campaignsTable).where(eq(campaignsTable.brandId, query.data.brandId)).orderBy(campaignsTable.createdAt);
  } else {
    results = await db.select().from(campaignsTable).orderBy(campaignsTable.createdAt);
  }

  res.json(GetCampaignsResponse.parse(results));
});

router.get("/campaigns/check-duplicate", async (req, res): Promise<void> => {
  const { templateId, primaryAssetId } = req.query as Record<string, string>;

  if (!templateId || !primaryAssetId) {
    res.json({ duplicate: false });
    return;
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const results = await db.select().from(campaignsTable)
    .where(and(
      eq(campaignsTable.templateId, templateId),
      gte(campaignsTable.createdAt, thirtyDaysAgo),
    ))
    .orderBy(campaignsTable.createdAt);

  const matches = results.filter(c => {
    const assets = (c.selectedAssets || []) as Array<{ assetId: string; role: string }>;
    return assets.some(a => a.assetId === primaryAssetId && a.role === "primary");
  });

  if (matches.length > 0) {
    const match = matches[matches.length - 1];
    res.json({
      duplicate: true,
      campaignId: match.id,
      campaignName: match.name,
      createdAt: match.createdAt,
    });
  } else {
    res.json({ duplicate: false });
  }
});

router.post("/campaigns", async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [campaign] = await db.insert(campaignsTable).values(parsed.data).returning();
  res.status(201).json(GetCampaignResponse.parse(campaign));
});

router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.json(GetCampaignResponse.parse(campaign));
});

router.put("/campaigns/:id", async (req, res): Promise<void> => {
  const params = UpdateCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [campaign] = await db
    .update(campaignsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(campaignsTable.id, params.data.id))
    .returning();

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.json(UpdateCampaignResponse.parse(campaign));
});

router.post("/campaigns/:id/schedule", async (req, res): Promise<void> => {
  const campaignId = req.params.id;
  const { scheduledAt, perPlatform } = req.body as {
    scheduledAt?: string;
    perPlatform?: Record<string, string>;
  };

  if (!scheduledAt && !perPlatform) {
    res.status(400).json({ error: "Either scheduledAt or perPlatform times required" });
    return;
  }

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const variants = await db.select().from(campaignVariantsTable)
    .where(eq(campaignVariantsTable.campaignId, campaignId));

  if (variants.length === 0) {
    res.status(400).json({ error: "No variants to schedule" });
    return;
  }

  const created = [];
  for (const variant of variants) {
    const time = perPlatform?.[variant.platform] || scheduledAt;
    if (!time) continue;

    const [entry] = await db.insert(calendarEntriesTable).values({
      campaignId,
      variantId: variant.id,
      platform: variant.platform,
      scheduledAt: new Date(time),
    }).returning();
    created.push(entry);
  }

  await db.update(campaignsTable)
    .set({ status: "scheduled", updatedAt: new Date() })
    .where(eq(campaignsTable.id, campaignId));

  res.status(201).json({ entries: created, count: created.length });
});

export default router;
