import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, campaignsTable, campaignVariantsTable, costLogsTable } from "@workspace/db";
import { assembleContext, type SelectedAssetRef } from "../services/context-assembly.js";
import { generateCaptions, estimateClaudeCost } from "../services/claude.js";
import { generateAllImages, estimateImagenCost, PLATFORM_CONFIGS } from "../services/imagen.js";
import { compositeImage } from "../services/compositing.js";
import * as fs from "fs";
import * as path from "path";

const router: IRouter = Router();

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads", "generated");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

router.post("/campaigns/:id/generate", async (req: Request, res: Response): Promise<void> => {
  const campaignId = req.params.id;

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  if (!campaign.templateId) {
    res.status(400).json({ error: "Campaign must have a template selected" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let clientDisconnected = false;
  req.on("close", () => { clientDisconnected = true; });

  function sendEvent(event: string, data: Record<string, unknown>) {
    if (clientDisconnected) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    await db.update(campaignsTable)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(campaignsTable.id, campaignId));
    sendEvent("status", { status: "generating", message: "Starting generation..." });

    sendEvent("progress", { step: "context", message: "Assembling context from brand DNA..." });
    const selectedAssets = (campaign.selectedAssets || []) as SelectedAssetRef[];
    const ctx = await assembleContext({
      brandId: campaign.brandId,
      templateId: campaign.templateId,
      selectedAssets,
      selectedHashtagSetIds: (campaign.selectedHashtagSets || []) as string[],
      briefText: campaign.briefText || undefined,
      referenceAnalysis: campaign.referenceAnalysis as Record<string, unknown> | null,
    });
    sendEvent("progress", { step: "context", message: "Context assembled", done: true });

    const platforms = Object.keys(PLATFORM_CONFIGS);

    sendEvent("progress", { step: "captions", message: "Generating captions with Claude..." });
    const captionsPromise = generateCaptions(ctx);

    sendEvent("progress", { step: "images", message: "Generating images for all platforms..." });
    const imagesPromise = generateAllImages(ctx, platforms, (platform, status, error) => {
      sendEvent("image_progress", { platform, status, error });
    });

    const [captions, images] = await Promise.all([captionsPromise, imagesPromise]);

    sendEvent("progress", { step: "captions", message: "Captions generated", done: true });
    sendEvent("progress", { step: "images", message: `${images.length} images generated`, done: true });

    sendEvent("progress", { step: "compositing", message: "Compositing images with overlays..." });
    const layoutSpec = ctx.template.layoutSpec as Record<string, unknown> | null;

    ensureDir(UPLOADS_DIR);

    const variantRecords = [];

    for (const img of images) {
      const platformKey = img.platform as keyof typeof captions;
      const captionData = captions[platformKey] || { caption: "", headline: "" };
      const config = PLATFORM_CONFIGS[img.platform];

      const rawFilename = `${campaignId}_${img.platform}_raw.png`;
      const rawPath = path.join(UPLOADS_DIR, rawFilename);
      fs.writeFileSync(rawPath, img.imageBuffer);

      let compositedBuffer: Buffer;
      try {
        compositedBuffer = await compositeImage({
          rawImageBuffer: img.imageBuffer,
          layoutSpec: layoutSpec as any,
          headlineText: captionData.headline || null,
          logoBuffer: null,
          width: config.width,
          height: config.height,
        });
      } catch {
        compositedBuffer = img.imageBuffer;
      }

      const compFilename = `${campaignId}_${img.platform}_composited.png`;
      const compPath = path.join(UPLOADS_DIR, compFilename);
      fs.writeFileSync(compPath, compositedBuffer);

      variantRecords.push({
        campaignId,
        platform: img.platform,
        aspectRatio: img.aspectRatio,
        rawImageUrl: `/api/files/generated/${rawFilename}`,
        compositedImageUrl: `/api/files/generated/${compFilename}`,
        caption: captionData.caption,
        originalCaption: captionData.caption,
        headlineText: captionData.headline,
        originalHeadline: captionData.headline,
        status: "generated",
      });

      sendEvent("variant_ready", {
        platform: img.platform,
        aspectRatio: img.aspectRatio,
        rawImageUrl: `/api/files/generated/${rawFilename}`,
        compositedImageUrl: `/api/files/generated/${compFilename}`,
        caption: captionData.caption,
        headline: captionData.headline,
      });
    }

    sendEvent("progress", { step: "compositing", message: "Compositing complete", done: true });

    sendEvent("progress", { step: "saving", message: "Saving variants to database..." });
    const existingVariants = await db.select().from(campaignVariantsTable)
      .where(eq(campaignVariantsTable.campaignId, campaignId));
    if (existingVariants.length > 0) {
      for (const v of existingVariants) {
        await db.delete(campaignVariantsTable).where(eq(campaignVariantsTable.id, v.id));
      }
    }

    const insertedVariants = [];
    for (const record of variantRecords) {
      const [inserted] = await db.insert(campaignVariantsTable).values(record).returning();
      insertedVariants.push(inserted);
    }

    await db.update(campaignsTable)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(campaignsTable.id, campaignId));

    const totalCost = estimateClaudeCost() + estimateImagenCost(images.length);
    await db.insert(costLogsTable).values({
      campaignId,
      service: "anthropic",
      operation: "caption_generation",
      model: "claude-sonnet-4-6",
      costUsd: estimateClaudeCost(),
    });
    await db.insert(costLogsTable).values({
      campaignId,
      service: "gemini",
      operation: "image_generation",
      model: "gemini-2.5-flash-image",
      costUsd: estimateImagenCost(images.length),
    });

    if (campaign.estimatedCost !== totalCost) {
      await db.update(campaignsTable)
        .set({ estimatedCost: totalCost, updatedAt: new Date() })
        .where(eq(campaignsTable.id, campaignId));
    }

    sendEvent("complete", {
      message: "Generation complete!",
      variantCount: insertedVariants.length,
      estimatedCost: totalCost,
      variants: insertedVariants,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendEvent("error", { message: `Generation failed: ${message}` });
    await db.update(campaignsTable)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(campaignsTable.id, campaignId));
  } finally {
    res.end();
  }
});

router.put("/campaigns/:id/variants/:variantId/caption", async (req: Request, res: Response): Promise<void> => {
  const { id: campaignId, variantId } = req.params;
  const { caption } = req.body;

  if (!caption) {
    res.status(400).json({ error: "Caption is required" });
    return;
  }

  const [variant] = await db.select().from(campaignVariantsTable)
    .where(eq(campaignVariantsTable.id, variantId));
  if (!variant || variant.campaignId !== campaignId) {
    res.status(404).json({ error: "Variant not found" });
    return;
  }

  const [updated] = await db.update(campaignVariantsTable)
    .set({ caption, updatedAt: new Date() })
    .where(eq(campaignVariantsTable.id, variantId))
    .returning();

  res.json(updated);
});

router.put("/campaigns/:id/variants/:variantId/headline", async (req: Request, res: Response): Promise<void> => {
  const { id: campaignId, variantId } = req.params;
  const { headline } = req.body;

  if (!headline) {
    res.status(400).json({ error: "Headline is required" });
    return;
  }

  const [variant] = await db.select().from(campaignVariantsTable)
    .where(eq(campaignVariantsTable.id, variantId));
  if (!variant || variant.campaignId !== campaignId) {
    res.status(404).json({ error: "Variant not found" });
    return;
  }

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!campaign || !campaign.templateId) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const config = PLATFORM_CONFIGS[variant.platform];
  if (!config) {
    res.status(400).json({ error: "Unknown platform" });
    return;
  }

  let compositedUrl = variant.compositedImageUrl;
  if (variant.rawImageUrl) {
    try {
      const rawFilename = variant.rawImageUrl.replace("/api/files/generated/", "");
      const rawPath = path.join(UPLOADS_DIR, rawFilename);
      if (fs.existsSync(rawPath)) {
        const rawBuffer = fs.readFileSync(rawPath);
        const { assembleContext: assemble } = await import("../services/context-assembly.js");
        const ctx = await assemble({
          brandId: campaign.brandId,
          templateId: campaign.templateId,
          selectedAssets: [],
        });

        const newComposited = await compositeImage({
          rawImageBuffer: rawBuffer,
          layoutSpec: ctx.template.layoutSpec as any,
          headlineText: headline,
          logoBuffer: null,
          width: config.width,
          height: config.height,
        });

        const compFilename = `${campaignId}_${variant.platform}_composited.png`;
        const compPath = path.join(UPLOADS_DIR, compFilename);
        fs.writeFileSync(compPath, newComposited);
        compositedUrl = `/api/files/generated/${compFilename}`;
      }
    } catch {
    }
  }

  const [updated] = await db.update(campaignVariantsTable)
    .set({ headlineText: headline, compositedImageUrl: compositedUrl, updatedAt: new Date() })
    .where(eq(campaignVariantsTable.id, variantId))
    .returning();

  res.json(updated);
});

router.post("/campaigns/:id/variants/:variantId/regenerate", async (req: Request, res: Response): Promise<void> => {
  const { id: campaignId, variantId } = req.params;
  const { instruction } = req.body || {};

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (!campaign.templateId) {
    res.status(400).json({ error: "Campaign must have a template" });
    return;
  }

  const [variant] = await db.select().from(campaignVariantsTable).where(eq(campaignVariantsTable.id, variantId));
  if (!variant || variant.campaignId !== campaignId) {
    res.status(404).json({ error: "Variant not found" });
    return;
  }

  const config = PLATFORM_CONFIGS[variant.platform];
  if (!config) {
    res.status(400).json({ error: "Unknown platform" });
    return;
  }

  try {
    const selectedAssets = (campaign.selectedAssets || []) as import("../services/context-assembly.js").SelectedAssetRef[];
    const ctx = await assembleContext({
      brandId: campaign.brandId,
      templateId: campaign.templateId,
      selectedAssets,
      selectedHashtagSetIds: (campaign.selectedHashtagSets || []) as string[],
      briefText: instruction
        ? `${campaign.briefText || ""}\n\nADDITIONAL REFINEMENT: ${instruction}`
        : campaign.briefText || undefined,
      referenceAnalysis: campaign.referenceAnalysis as Record<string, unknown> | null,
    });

    const { generateImage } = await import("../services/imagen.js");
    const imgResult = await generateImage(ctx, variant.platform);

    ensureDir(UPLOADS_DIR);

    const rawFilename = `${campaignId}_${variant.platform}_raw.png`;
    const rawPath = path.join(UPLOADS_DIR, rawFilename);
    fs.writeFileSync(rawPath, imgResult.imageBuffer);

    const layoutSpec = ctx.template.layoutSpec as Record<string, unknown> | null;
    let compositedBuffer: Buffer;
    try {
      compositedBuffer = await compositeImage({
        rawImageBuffer: imgResult.imageBuffer,
        layoutSpec: layoutSpec as any,
        headlineText: variant.headlineText || null,
        logoBuffer: null,
        width: config.width,
        height: config.height,
      });
    } catch {
      compositedBuffer = imgResult.imageBuffer;
    }

    const compFilename = `${campaignId}_${variant.platform}_composited.png`;
    const compPath = path.join(UPLOADS_DIR, compFilename);
    fs.writeFileSync(compPath, compositedBuffer);

    const [updated] = await db.update(campaignVariantsTable)
      .set({
        rawImageUrl: `/api/files/generated/${rawFilename}`,
        compositedImageUrl: `/api/files/generated/${compFilename}`,
        updatedAt: new Date(),
      })
      .where(eq(campaignVariantsTable.id, variantId))
      .returning();

    const cost = estimateImagenCost(1);
    await db.insert(costLogsTable).values({
      campaignId,
      service: "gemini",
      operation: "single_variant_regeneration",
      model: "gemini-2.5-flash-image",
      costUsd: cost,
    });

    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Regeneration failed: ${message}` });
  }
});

export default router;
