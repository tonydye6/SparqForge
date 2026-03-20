import { Router, type IRouter } from "express";
import { eq, and, ilike, or } from "drizzle-orm";
import { db, assetsTable } from "@workspace/db";
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

  const [asset] = await db.insert(assetsTable).values(parsed.data).returning();
  res.status(201).json(GetAssetResponse.parse(asset));
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

export default router;
