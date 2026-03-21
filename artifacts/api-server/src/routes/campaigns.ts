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
import { captureScreenshots, captureFromUpload, validateUrl } from "../services/screenshot.js";
import { analyzeReference } from "../services/reference-analysis.js";
import multer from "multer";

const router: IRouter = Router();
const ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (PNG, JPEG, WebP, GIF) are allowed"));
    }
  },
});

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

  const userId = (req as any).user?.id || "system";
  const [campaign] = await db.insert(campaignsTable).values({ ...parsed.data, createdBy: userId }).returning();
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
  const { scheduledAt, perPlatform, socialAccounts: socialAccountsMap } = req.body as {
    scheduledAt?: string;
    perPlatform?: Record<string, string>;
    socialAccounts?: Record<string, string>;
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

    const socialAccountId = socialAccountsMap?.[variant.platform] || null;

    const [entry] = await db.insert(calendarEntriesTable).values({
      campaignId,
      variantId: variant.id,
      platform: variant.platform,
      scheduledAt: new Date(time),
      socialAccountId,
    }).returning();
    created.push(entry);
  }

  await db.update(campaignsTable)
    .set({ status: "scheduled", updatedAt: new Date() })
    .where(eq(campaignsTable.id, campaignId));

  res.status(201).json({ entries: created, count: created.length });
});

router.post("/campaigns/:id/analyze-url", async (req, res): Promise<void> => {
  const campaignId = req.params.id;
  const { url } = req.body as { url?: string };

  if (!url) {
    res.status(400).json({ error: "URL is required" });
    return;
  }

  try {
    validateUrl(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid URL";
    res.status(400).json({ error: message });
    return;
  }

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  function sendEvent(event: string, data: Record<string, unknown>) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    sendEvent("progress", { phase: "capturing", message: "Capturing page screenshots..." });
    const screenshots = await captureScreenshots(url, campaignId);

    const screenshotUrls = screenshots.map(s => ({ url: s.url, viewport: s.viewport }));
    sendEvent("captured", {
      phase: "analyzing",
      message: "Analyzing reference design...",
      referenceScreenshots: screenshotUrls,
    });

    const screenshotPaths = screenshots.map(s => s.filepath);
    const analysis = await analyzeReference(screenshotPaths);

    await db.update(campaignsTable)
      .set({
        referenceUrl: url,
        referenceAnalysis: analysis,
        referenceScreenshots: screenshotUrls,
        updatedAt: new Date(),
      })
      .where(eq(campaignsTable.id, campaignId));

    sendEvent("complete", {
      phase: "done",
      referenceUrl: url,
      referenceAnalysis: analysis,
      referenceScreenshots: screenshotUrls,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendEvent("error", { message: `Reference analysis failed: ${message}` });
  } finally {
    res.end();
  }
});

router.post("/campaigns/:id/analyze-upload", upload.single("screenshot"), async (req, res): Promise<void> => {
  const campaignId = req.params.id;
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: "Screenshot file is required" });
    return;
  }

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  function sendEvent(event: string, data: Record<string, unknown>) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    sendEvent("progress", { phase: "capturing", message: "Processing uploaded screenshot..." });
    const screenshot = await captureFromUpload(file.buffer, campaignId, file.originalname);
    const screenshotUrls = [{ url: screenshot.url, viewport: screenshot.viewport }];

    sendEvent("captured", {
      phase: "analyzing",
      message: "Analyzing reference design...",
      referenceScreenshots: screenshotUrls,
    });

    const analysis = await analyzeReference([screenshot.filepath]);

    await db.update(campaignsTable)
      .set({
        referenceUrl: null,
        referenceAnalysis: analysis,
        referenceScreenshots: screenshotUrls,
        updatedAt: new Date(),
      })
      .where(eq(campaignsTable.id, campaignId));

    sendEvent("complete", {
      phase: "done",
      referenceUrl: null,
      referenceAnalysis: analysis,
      referenceScreenshots: screenshotUrls,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendEvent("error", { message: `Reference analysis failed: ${message}` });
  } finally {
    res.end();
  }
});

router.delete("/campaigns/:id/reference", async (req, res): Promise<void> => {
  const campaignId = req.params.id;

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  await db.update(campaignsTable)
    .set({
      referenceUrl: null,
      referenceAnalysis: null,
      referenceScreenshots: null,
      updatedAt: new Date(),
    })
    .where(eq(campaignsTable.id, campaignId));

  res.json({ cleared: true });
});

export default router;
