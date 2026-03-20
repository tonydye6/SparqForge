import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, brandsTable } from "@workspace/db";
import {
  CreateBrandBody,
  GetBrandParams,
  GetBrandsResponse,
  GetBrandResponse,
  UpdateBrandParams,
  UpdateBrandBody,
  UpdateBrandResponse,
  DeleteBrandParams,
  DeleteBrandResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/brands", async (_req, res): Promise<void> => {
  const brands = await db.select().from(brandsTable).orderBy(brandsTable.name);
  res.json(GetBrandsResponse.parse(brands));
});

router.post("/brands", async (req, res): Promise<void> => {
  const parsed = CreateBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [brand] = await db.insert(brandsTable).values(parsed.data).returning();
  res.status(201).json(GetBrandResponse.parse(brand));
});

router.get("/brands/:id", async (req, res): Promise<void> => {
  const params = GetBrandParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, params.data.id));
  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  res.json(GetBrandResponse.parse(brand));
});

router.put("/brands/:id", async (req, res): Promise<void> => {
  const params = UpdateBrandParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [brand] = await db
    .update(brandsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(brandsTable.id, params.data.id))
    .returning();

  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  res.json(UpdateBrandResponse.parse(brand));
});

router.delete("/brands/:id", async (req, res): Promise<void> => {
  const params = DeleteBrandParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [brand] = await db.delete(brandsTable).where(eq(brandsTable.id, params.data.id)).returning();
  if (!brand) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }

  res.json(DeleteBrandResponse.parse({ message: "Brand deleted" }));
});

export default router;
