import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, campaignsTable } from "@workspace/db";
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

export default router;
