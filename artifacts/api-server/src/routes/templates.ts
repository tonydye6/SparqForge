import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, templatesTable } from "@workspace/db";
import {
  GetTemplatesQueryParams,
  CreateTemplateBody,
  GetTemplateParams,
  GetTemplatesResponse,
  GetTemplateResponse,
  UpdateTemplateParams,
  UpdateTemplateBody,
  UpdateTemplateResponse,
  DeleteTemplateParams,
  DeleteTemplateResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/templates", async (req, res): Promise<void> => {
  const query = GetTemplatesQueryParams.safeParse(req.query);
  let results;

  if (query.success && query.data.brandId) {
    results = await db.select().from(templatesTable).where(eq(templatesTable.brandId, query.data.brandId)).orderBy(templatesTable.name);
  } else {
    results = await db.select().from(templatesTable).orderBy(templatesTable.name);
  }

  res.json(GetTemplatesResponse.parse(results));
});

router.post("/templates", async (req, res): Promise<void> => {
  const parsed = CreateTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [template] = await db.insert(templatesTable).values(parsed.data).returning();
  res.status(201).json(GetTemplateResponse.parse(template));
});

router.get("/templates/:id", async (req, res): Promise<void> => {
  const params = GetTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, params.data.id));
  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  res.json(GetTemplateResponse.parse(template));
});

router.put("/templates/:id", async (req, res): Promise<void> => {
  const params = UpdateTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [template] = await db
    .update(templatesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(templatesTable.id, params.data.id))
    .returning();

  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  res.json(UpdateTemplateResponse.parse(template));
});

router.delete("/templates/:id", async (req, res): Promise<void> => {
  const params = DeleteTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [template] = await db.delete(templatesTable).where(eq(templatesTable.id, params.data.id)).returning();
  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  res.json(DeleteTemplateResponse.parse({ message: "Template deleted" }));
});

export default router;
