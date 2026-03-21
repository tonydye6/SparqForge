import { Router, type IRouter } from "express";
import { eq, and, ilike, or, inArray } from "drizzle-orm";
import { db, assetsTable, campaignsTable } from "@workspace/db";
import {
  GetAssetsQueryParams,
  CreateAssetBody,
  GetAssetParams,
  GetAssetsResponse,
  GetAssetResponse,
  UpdateAssetParams,
  UpdateAssetBody,
  UpdateAssetResponse,
  DeleteAssetParams,
  DeleteAssetResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/assets", async (req, res): Promise<void> => {
  const query = GetAssetsQueryParams.safeParse(req.query);
  const conditions = [];

  if (query.success) {
    if (query.data.brandId) conditions.push(eq(assetsTable.brandId, query.data.brandId));
    if (query.data.type) conditions.push(eq(assetsTable.type, query.data.type));
    if (query.data.status) conditions.push(eq(assetsTable.status, query.data.status));
    if (query.data.search) {
      conditions.push(
        or(
          ilike(assetsTable.name, `%${query.data.search}%`),
          ilike(assetsTable.description, `%${query.data.search}%`)
        )!
      );
    }
  }

  let results;
  if (conditions.length > 0) {
    results = await db.select().from(assetsTable).where(and(...conditions)).orderBy(assetsTable.createdAt);
  } else {
    results = await db.select().from(assetsTable).orderBy(assetsTable.createdAt);
  }

  res.json(GetAssetsResponse.parse(results));
});

router.post("/assets", async (req, res): Promise<void> => {
  const parsed = CreateAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req as any).user?.id || "system";
  const [asset] = await db.insert(assetsTable).values({ ...parsed.data, uploadedBy: userId }).returning();
  res.status(201).json(GetAssetResponse.parse(asset));
});

const VALID_ASSET_STATUSES = ["uploaded", "approved", "archived"];

router.post("/assets/bulk-update", async (req, res): Promise<void> => {
  const { ids, status, tags } = req.body as {
    ids?: string[];
    status?: string;
    tags?: string[];
  };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array is required and must not be empty" });
    return;
  }

  if (status && !VALID_ASSET_STATUSES.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_ASSET_STATUSES.join(", ")}` });
    return;
  }

  if (tags && (!Array.isArray(tags) || tags.some(t => typeof t !== "string"))) {
    res.status(400).json({ error: "tags must be an array of strings" });
    return;
  }

  if (!status && (!tags || tags.length === 0)) {
    res.status(400).json({ error: "At least one of status or tags must be provided" });
    return;
  }

  if (tags && tags.length > 0) {
    const existing = await db.select().from(assetsTable).where(inArray(assetsTable.id, ids));
    const allResults = [];
    for (const asset of existing) {
      const existingTags = (asset.tags || []) as string[];
      const merged = [...new Set([...existingTags, ...tags])];
      const updateData: Record<string, unknown> = { tags: merged, updatedAt: new Date() };
      if (status) {
        updateData.status = status;
        if (status === "approved") updateData.approvedAt = new Date();
      }
      const [updated] = await db
        .update(assetsTable)
        .set(updateData)
        .where(eq(assetsTable.id, asset.id))
        .returning();
      if (updated) allResults.push(updated);
    }
    res.json({ updated: allResults.length, assets: allResults });
    return;
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (status) {
    updateData.status = status;
    if (status === "approved") updateData.approvedAt = new Date();
  }

  const results = await db
    .update(assetsTable)
    .set(updateData)
    .where(inArray(assetsTable.id, ids))
    .returning();

  res.json({ updated: results.length, assets: results });
});

router.get("/assets/:id", async (req, res): Promise<void> => {
  const params = GetAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, params.data.id));
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  res.json(GetAssetResponse.parse(asset));
});

router.put("/assets/:id", async (req, res): Promise<void> => {
  const params = UpdateAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };

  if (parsed.data.status === "approved" && parsed.data.approvedBy) {
    updateData.approvedAt = new Date();
  }

  const [asset] = await db
    .update(assetsTable)
    .set(updateData)
    .where(eq(assetsTable.id, params.data.id))
    .returning();

  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  res.json(UpdateAssetResponse.parse(asset));
});

router.delete("/assets/:id", async (req, res): Promise<void> => {
  const params = DeleteAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [asset] = await db.delete(assetsTable).where(eq(assetsTable.id, params.data.id)).returning();
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  res.json(DeleteAssetResponse.parse({ message: "Asset deleted" }));
});

router.get("/assets/:id/usage", async (req, res): Promise<void> => {
  const assetId = req.params.id;

  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, assetId));
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  const allCampaigns = await db.select().from(campaignsTable).orderBy(campaignsTable.createdAt);

  const usedIn = allCampaigns.filter(campaign => {
    const selectedAssets = (campaign.selectedAssets || []) as Array<{ assetId: string; role: string }>;
    return selectedAssets.some(a => a.assetId === assetId);
  });

  res.json(usedIn.map(c => ({
    id: c.id,
    name: c.name,
    status: c.status,
    createdAt: c.createdAt,
  })));
});

export default router;
