import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, hashtagSetsTable } from "@workspace/db";
import {
  GetHashtagSetsQueryParams,
  CreateHashtagSetBody,
  UpdateHashtagSetParams,
  GetHashtagSetsResponse,
  UpdateHashtagSetBody,
  UpdateHashtagSetResponse,
  DeleteHashtagSetParams,
  DeleteHashtagSetResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/hashtag-sets", async (req, res): Promise<void> => {
  const query = GetHashtagSetsQueryParams.safeParse(req.query);
  let results;

  if (query.success && query.data.brandId) {
    if (query.data.category) {
      results = await db.select().from(hashtagSetsTable)
        .where(eq(hashtagSetsTable.brandId, query.data.brandId))
        .orderBy(hashtagSetsTable.category, hashtagSetsTable.name);
    } else {
      results = await db.select().from(hashtagSetsTable)
        .where(eq(hashtagSetsTable.brandId, query.data.brandId))
        .orderBy(hashtagSetsTable.category, hashtagSetsTable.name);
    }
  } else {
    results = await db.select().from(hashtagSetsTable).orderBy(hashtagSetsTable.category, hashtagSetsTable.name);
  }

  res.json(GetHashtagSetsResponse.parse(results));
});

router.post("/hashtag-sets", async (req, res): Promise<void> => {
  const parsed = CreateHashtagSetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [set] = await db.insert(hashtagSetsTable).values(parsed.data).returning();
  res.status(201).json(UpdateHashtagSetResponse.parse(set));
});

router.put("/hashtag-sets/:id", async (req, res): Promise<void> => {
  const params = UpdateHashtagSetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateHashtagSetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [set] = await db
    .update(hashtagSetsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(hashtagSetsTable.id, params.data.id))
    .returning();

  if (!set) {
    res.status(404).json({ error: "Hashtag set not found" });
    return;
  }

  res.json(UpdateHashtagSetResponse.parse(set));
});

router.delete("/hashtag-sets/:id", async (req, res): Promise<void> => {
  const params = DeleteHashtagSetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [set] = await db.delete(hashtagSetsTable).where(eq(hashtagSetsTable.id, params.data.id)).returning();
  if (!set) {
    res.status(404).json({ error: "Hashtag set not found" });
    return;
  }

  res.json(DeleteHashtagSetResponse.parse({ message: "Hashtag set deleted" }));
});

export default router;
