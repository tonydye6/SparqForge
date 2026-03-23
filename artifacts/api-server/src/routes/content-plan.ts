import { Router, type IRouter } from "express";
import { eq, and, SQL } from "drizzle-orm";
import { db, socialContentPlanItemsTable, brandsTable, templatesTable, campaignsTable, type PlanItem } from "@workspace/db";
import multer from "multer";
import { parse as csvParseSync } from "csv-parse/sync";

const router: IRouter = Router();

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

const VALID_PLATFORMS_LOWER = new Set([
  "instagram", "tiktok", "youtube", "linkedin", "x",
  "facebook", "pinterest", "snapchat", "threads",
]);

const VALID_STATUSES = new Set(["planned", "in_progress", "completed", "cancelled"]);

function isValidPlatform(p: string): boolean {
  return VALID_PLATFORMS_LOWER.has(p.toLowerCase());
}

function parseCSV(text: string): Record<string, string>[] {
  const records: Record<string, string>[] = csvParseSync(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  return records;
}

router.post("/content-plan/import", csvUpload.single("file"), async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "CSV file is required" });
    return;
  }

  const csvText = file.buffer.toString("utf-8");
  const rows = parseCSV(csvText);

  if (rows.length === 0) {
    res.status(400).json({ error: "CSV file is empty or has no data rows" });
    return;
  }

  const imported: PlanItem[] = [];
  const rejected: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    if (!row.title || !row.title.trim()) {
      rejected.push({ row: rowNum, reason: "Missing required field: title" });
      continue;
    }

    if (!row.primary_platform || !row.primary_platform.trim()) {
      rejected.push({ row: rowNum, reason: "Missing required field: primary_platform" });
      continue;
    }

    if (!isValidPlatform(row.primary_platform.trim())) {
      rejected.push({ row: rowNum, reason: `Invalid primary_platform: "${row.primary_platform}"` });
      continue;
    }

    const secondaryPlatforms = row.secondary_platforms
      ? row.secondary_platforms.split("|").map(p => p.trim()).filter(Boolean)
      : [];

    const invalidSecondary = secondaryPlatforms.filter(p => !isValidPlatform(p));
    if (invalidSecondary.length > 0) {
      rejected.push({ row: rowNum, reason: `Invalid secondary platform(s): ${invalidSecondary.join(", ")}` });
      continue;
    }

    const requiredAssetRoles = row.required_asset_roles
      ? row.required_asset_roles.split("|").map(r => r.trim()).filter(Boolean)
      : [];

    try {
      const [item] = await db.insert(socialContentPlanItemsTable).values({
        title: row.title.trim(),
        campaignName: row.campaign_name?.trim() || null,
        primaryPlatform: row.primary_platform.trim(),
        secondaryPlatforms,
        templateName: row.template_name?.trim() || null,
        pillar: row.pillar?.trim() || null,
        audience: row.audience?.trim() || null,
        brandLayer: row.brand_layer?.trim() || null,
        objective: row.objective?.trim() || null,
        contentType: row.content_type?.trim() || null,
        assetPacketType: row.asset_packet_type?.trim() || null,
        coreMessage: row.core_message?.trim() || null,
        cta: row.cta?.trim() || null,
        requiredAssetRoles,
        plannedWeek: row.planned_week?.trim() || null,
        plannedDate: row.planned_date?.trim() || null,
        notes: row.notes?.trim() || null,
      }).returning();
      imported.push(item);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rejected.push({ row: rowNum, reason: `Database error: ${message}` });
    }
  }

  res.json({
    imported: imported.length,
    rejected: rejected.length,
    rejectedDetails: rejected,
    items: imported,
  });
});

router.get("/content-plan", async (req, res): Promise<void> => {
  const { pillar, platform, status, plannedWeek, brandLayer } = req.query as Record<string, string | undefined>;

  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit as string, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);

  const conditions: SQL[] = [];
  if (pillar) conditions.push(eq(socialContentPlanItemsTable.pillar, pillar));
  if (platform) conditions.push(eq(socialContentPlanItemsTable.primaryPlatform, platform));
  if (status) conditions.push(eq(socialContentPlanItemsTable.status, status));
  if (plannedWeek) conditions.push(eq(socialContentPlanItemsTable.plannedWeek, plannedWeek));
  if (brandLayer) conditions.push(eq(socialContentPlanItemsTable.brandLayer, brandLayer));

  let query = db.select().from(socialContentPlanItemsTable);
  const results = conditions.length > 0
    ? await query.where(and(...conditions)).orderBy(socialContentPlanItemsTable.createdAt).limit(limit).offset(offset)
    : await query.orderBy(socialContentPlanItemsTable.createdAt).limit(limit).offset(offset);

  res.json(results);
});

router.get("/content-plan/:id", async (req, res): Promise<void> => {
  const [item] = await db.select().from(socialContentPlanItemsTable)
    .where(eq(socialContentPlanItemsTable.id, req.params.id));

  if (!item) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }

  res.json(item);
});

router.post("/content-plan", async (req, res): Promise<void> => {
  const body = req.body;

  if (!body.title?.trim() || !body.primaryPlatform?.trim()) {
    res.status(400).json({ error: "title and primaryPlatform are required" });
    return;
  }

  if (!isValidPlatform(body.primaryPlatform)) {
    res.status(400).json({ error: `Invalid platform: "${body.primaryPlatform}"` });
    return;
  }

  if (body.status && !VALID_STATUSES.has(body.status)) {
    res.status(400).json({ error: `Invalid status: "${body.status}"` });
    return;
  }

  const [item] = await db.insert(socialContentPlanItemsTable).values({
    title: body.title.trim(),
    campaignName: body.campaignName || null,
    primaryPlatform: body.primaryPlatform.trim(),
    secondaryPlatforms: body.secondaryPlatforms || [],
    templateName: body.templateName || null,
    pillar: body.pillar || null,
    audience: body.audience || null,
    brandLayer: body.brandLayer || null,
    objective: body.objective || null,
    contentType: body.contentType || null,
    assetPacketType: body.assetPacketType || null,
    coreMessage: body.coreMessage || null,
    cta: body.cta || null,
    requiredAssetRoles: body.requiredAssetRoles || [],
    plannedWeek: body.plannedWeek || null,
    plannedDate: body.plannedDate || null,
    notes: body.notes || null,
  }).returning();

  res.status(201).json(item);
});

router.put("/content-plan/:id", async (req, res): Promise<void> => {
  const body = req.body;

  if (body.primaryPlatform && !isValidPlatform(body.primaryPlatform)) {
    res.status(400).json({ error: `Invalid platform: "${body.primaryPlatform}"` });
    return;
  }

  if (body.status && !VALID_STATUSES.has(body.status)) {
    res.status(400).json({ error: `Invalid status: "${body.status}"` });
    return;
  }

  const { id: _id, createdAt: _ca, ...updateFields } = body;

  const [item] = await db.update(socialContentPlanItemsTable)
    .set({ ...updateFields, updatedAt: new Date() })
    .where(eq(socialContentPlanItemsTable.id, req.params.id))
    .returning();

  if (!item) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }

  res.json(item);
});

router.delete("/content-plan/:id", async (req, res): Promise<void> => {
  const [item] = await db.delete(socialContentPlanItemsTable)
    .where(eq(socialContentPlanItemsTable.id, req.params.id))
    .returning();

  if (!item) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }

  res.json({ deleted: true });
});

router.post("/content-plan/:id/create-campaign", async (req, res): Promise<void> => {
  const [planItem] = await db.select().from(socialContentPlanItemsTable)
    .where(eq(socialContentPlanItemsTable.id, req.params.id));

  if (!planItem) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }

  if (planItem.linkedCampaignId) {
    res.status(400).json({ error: "Plan item already has a linked campaign", campaignId: planItem.linkedCampaignId });
    return;
  }

  let brandId: string | null = null;
  if (planItem.brandLayer) {
    const brands = await db.select().from(brandsTable);
    const layerKey = planItem.brandLayer.toLowerCase();
    const match = brands.find(b => {
      const bName = b.name.toLowerCase();
      const bSlug = b.slug.toLowerCase();
      return bName === layerKey || bSlug === layerKey;
    });
    if (match) brandId = match.id;
  }

  if (!brandId) {
    const [firstBrand] = await db.select().from(brandsTable).limit(1);
    if (firstBrand) brandId = firstBrand.id;
  }

  if (!brandId) {
    res.status(400).json({ error: "No brand found. Please create a brand first." });
    return;
  }

  let templateId: string | null = null;
  if (planItem.templateName) {
    const templates = await db.select().from(templatesTable);
    const match = templates.find(t =>
      t.name.toLowerCase() === planItem.templateName!.toLowerCase() ||
      t.name.toLowerCase().includes(planItem.templateName!.toLowerCase())
    );
    if (match) templateId = match.id;
  }

  const userId = ((req as Record<string, unknown>).user as { id?: string } | undefined)?.id || "system";

  try {
    const result = await db.transaction(async (tx) => {
      const [campaign] = await tx.insert(campaignsTable).values({
        brandId: brandId!,
        templateId,
        name: planItem.title,
        status: "draft",
        briefText: planItem.coreMessage || "",
        createdBy: userId,
      }).returning();

      await tx.update(socialContentPlanItemsTable)
        .set({
          status: "in_progress",
          linkedCampaignId: campaign.id,
          updatedAt: new Date(),
        })
        .where(eq(socialContentPlanItemsTable.id, planItem.id));

      return campaign;
    });

    res.status(201).json({
      campaign: result,
      planItem: {
        ...planItem,
        status: "in_progress",
        linkedCampaignId: result.id,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to create campaign: ${message}` });
  }
});

export default router;
