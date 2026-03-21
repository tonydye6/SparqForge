import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, campaignsTable, campaignVariantsTable, costLogsTable, refinementLogsTable, templatesTable, appSettingsTable, assetsTable, assetPairingsTable, brandsTable, generationPacketLogsTable } from "@workspace/db";
import { sql, gte } from "drizzle-orm";
import { assembleContext, type SelectedAssetRef } from "../services/context-assembly.js";
import { generateCaptions, estimateClaudeCost } from "../services/claude.js";
import { generateAllImages, generateImage, estimateImagenCost, PLATFORM_CONFIGS, type ReferenceImage } from "../services/imagen.js";
import { compositeImage } from "../services/compositing.js";
import { buildGenerationPacket } from "../services/packet-assembly.js";
import * as fs from "fs";
import * as path from "path";

const router: IRouter = Router();

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads", "generated");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveLocalFilePath(fileUrl: string): string | null {
  if (!fileUrl || fileUrl.startsWith("http")) return null;
  const resolved = path.resolve(process.cwd(), fileUrl.replace(/^\/api\/files\//, "uploads/"));
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  if (!resolved.startsWith(uploadsRoot)) return null;
  return resolved;
}

async function fetchLogoBuffer(brandId: string): Promise<Buffer | null> {
  try {
    const logoAssets = await db.select().from(assetsTable)
      .where(and(
        eq(assetsTable.brandId, brandId),
        eq(assetsTable.assetClass, "compositing"),
        eq(assetsTable.type, "image"),
      ));

    const [logoAsset] = logoAssets
      .filter(a => a.generationRole === "compositing_logo" || (a.subType && a.subType.includes("logo")))
      .sort((a, b) => {
        if (a.subType?.includes("primary")) return -1;
        if (b.subType?.includes("primary")) return 1;
        return 0;
      });

    if (logoAsset?.fileUrl) {
      const logoPath = resolveLocalFilePath(logoAsset.fileUrl);
      if (logoPath && fs.existsSync(logoPath)) {
        return fs.readFileSync(logoPath);
      }
    }

    const [brand] = await db.select().from(brandsTable)
      .where(eq(brandsTable.id, brandId));
    if (brand?.logoFileUrl) {
      const logoPath = resolveLocalFilePath(brand.logoFileUrl);
      if (logoPath && fs.existsSync(logoPath)) {
        return fs.readFileSync(logoPath);
      }
    }
  } catch (err) {
    console.error("Failed to fetch logo buffer:", err instanceof Error ? err.message : err);
  }
  return null;
}

async function fetchBrandFontFamily(brandId: string): Promise<string | undefined> {
  try {
    const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
    const fonts = (brand?.brandFonts || []) as Array<{ name?: string; assetId?: string }>;
    if (fonts.length > 0 && fonts[0].name) {
      return fonts[0].name;
    }
  } catch (err) {
    console.error("Failed to fetch brand font:", err instanceof Error ? err.message : err);
  }
  return undefined;
}

async function buildReferenceImages(packet: Awaited<ReturnType<typeof buildGenerationPacket>>): Promise<ReferenceImage[]> {
  const refs: ReferenceImage[] = [];

  for (const entry of packet.generationAssets.slice(0, 3)) {
    if (!entry.asset.fileUrl) continue;

    try {
      let buffer: Buffer | null = null;
      const localPath = resolveLocalFilePath(entry.asset.fileUrl);
      if (localPath && fs.existsSync(localPath)) {
        buffer = fs.readFileSync(localPath);
      }

      if (buffer) {
        refs.push({
          imageBuffer: buffer,
          mimeType: entry.asset.mimeType || "image/png",
          role: entry.role === "style_reference" ? "style_reference" : "subject_reference",
          description: entry.asset.description || entry.asset.name,
        });
      }
    } catch (err) {
      console.error(`Failed to load reference image for asset ${entry.asset.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return refs;
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

  const [thresholdRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "dailyCostThreshold"));
  const budgetThreshold = thresholdRow ? parseFloat(thresholdRow.value) : null;

  if (budgetThreshold !== null && !isNaN(budgetThreshold) && budgetThreshold > 0) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [todayResult] = await db.select({
      totalCost: sql<number>`COALESCE(SUM(${costLogsTable.costUsd}), 0)`,
    }).from(costLogsTable).where(gte(costLogsTable.createdAt, todayStart));

    const todaySpend = Number(todayResult?.totalCost || 0);
    if (todaySpend >= budgetThreshold) {
      res.status(429).json({
        error: "Daily budget exceeded",
        todaySpend,
        threshold: budgetThreshold,
        message: `Today's spend ($${todaySpend.toFixed(2)}) has reached the daily budget limit ($${budgetThreshold.toFixed(2)}). Increase the limit in Cost Dashboard settings or wait until tomorrow.`,
      });
      return;
    }
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

    sendEvent("progress", { step: "packet", message: "Building generation packet..." });
    const selectedAssets = (campaign.selectedAssets || []) as SelectedAssetRef[];
    const selectedAssetIds = selectedAssets.map(a => a.assetId);

    let packet: Awaited<ReturnType<typeof buildGenerationPacket>> | null = null;
    let referenceImages: ReferenceImage[] = [];

    if (selectedAssetIds.length > 0) {
      packet = await buildGenerationPacket({
        campaignId,
        brandId: campaign.brandId,
        templateId: campaign.templateId,
        platform: "all",
        selectedAssetIds,
      });
      sendEvent("progress", {
        step: "packet",
        message: `Packet assembled: ${packet.generationAssets.length} generation, ${packet.compositingAssets.length} compositing`,
        done: true,
        reasoning: packet.reasoning.strategy,
      });

      referenceImages = await buildReferenceImages(packet);
      if (referenceImages.length > 0) {
        sendEvent("progress", { step: "references", message: `${referenceImages.length} reference image(s) loaded for AI generation` });
      }
    } else {
      sendEvent("progress", { step: "packet", message: "No assets selected, using text-only generation", done: true });
    }

    sendEvent("progress", { step: "context", message: "Assembling context from brand DNA..." });
    const ctx = await assembleContext({
      brandId: campaign.brandId,
      templateId: campaign.templateId,
      selectedAssets,
      selectedHashtagSetIds: (campaign.selectedHashtagSets || []) as string[],
      briefText: campaign.briefText || undefined,
      referenceAnalysis: campaign.referenceAnalysis as Record<string, unknown> | null,
      generationPacket: packet,
    });
    sendEvent("progress", { step: "context", message: "Context assembled", done: true });

    const allPlatforms = Object.keys(PLATFORM_CONFIGS);
    const requestedPlatforms = Array.isArray(req.body?.platforms) ? req.body.platforms.filter((p: string) => allPlatforms.includes(p)) : [];
    const platforms = requestedPlatforms.length > 0 ? requestedPlatforms : allPlatforms;

    sendEvent("progress", { step: "captions", message: "Generating captions with Claude..." });
    const captionsPromise = generateCaptions(ctx);

    sendEvent("progress", { step: "images", message: "Generating images for all platforms..." });
    const imagesPromise = generateAllImages(ctx, platforms, (platform, status, error) => {
      sendEvent("image_progress", { platform, status, error });
    }, referenceImages);

    const captions = await captionsPromise;
    sendEvent("progress", { step: "captions", message: "Captions generated", done: true });

    for (const platform of platforms) {
      const platformKey = platform as keyof typeof captions;
      const captionData = captions[platformKey] || { caption: "", headline: "" };
      const config = PLATFORM_CONFIGS[platform];
      sendEvent("caption_ready", {
        platform,
        aspectRatio: config ? `${config.width}:${config.height}` : "1:1",
        caption: captionData.caption,
        headline: captionData.headline,
      });
    }

    const images = await imagesPromise;
    sendEvent("progress", { step: "images", message: `${images.length} images generated`, done: true });

    sendEvent("progress", { step: "compositing", message: "Compositing images with overlays..." });
    const layoutSpec = ctx.template.layoutSpec as Record<string, unknown> | null;

    const [logoBuffer, brandFontFamily] = await Promise.all([
      fetchLogoBuffer(campaign.brandId),
      fetchBrandFontFamily(campaign.brandId),
    ]);
    if (logoBuffer) {
      sendEvent("progress", { step: "compositing", message: "Brand logo loaded for compositing" });
    }

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
          logoBuffer,
          width: config.width,
          height: config.height,
          fontFamily: brandFontFamily,
        });
      } catch (err) {
        console.error(`Compositing failed for ${img.platform}, using raw image:`, err instanceof Error ? err.message : err);
        compositedBuffer = img.imageBuffer;
      }

      if (packet && referenceImages.length > 0) {
        try {
          await db.insert(generationPacketLogsTable).values({
            campaignId,
            platform: img.platform,
            templateId: campaign.templateId,
            packetType: "reference_guided",
            primaryAssetId: packet.generationAssets[0]?.asset.id || null,
            supportingAssetIds: packet.generationAssets.slice(1).map(a => a.asset.id),
            styleAssetIds: packet.generationAssets.filter(a => a.role === "style_reference").map(a => a.asset.id),
            contextAssetIds: packet.contextAssets.map(a => a.asset.id),
            compositingAssetIds: packet.compositingAssets.map(a => a.asset.id),
            excludedAssetIds: packet.excludedAssets.map(a => a.asset.id),
            packetReasoning: { ...packet.reasoning, platform: img.platform, aspectRatio: img.aspectRatio },
          });
        } catch (err) {
          console.error(`Failed to log per-platform packet for ${img.platform}:`, err instanceof Error ? err.message : err);
        }
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

      sendEvent("image_ready", {
        platform: img.platform,
        aspectRatio: img.aspectRatio,
        rawImageUrl: `/api/files/generated/${rawFilename}`,
        compositedImageUrl: `/api/files/generated/${compFilename}`,
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

    if (campaign.templateId) {
      await db.update(templatesTable)
        .set({ totalGenerations: sql`COALESCE(${templatesTable.totalGenerations}, 0) + 1` })
        .where(eq(templatesTable.id, campaign.templateId));
    }

    if (packet && packet.generationAssets.length >= 2) {
      try {
        const primary = packet.generationAssets[0];
        for (let i = 1; i < packet.generationAssets.length; i++) {
          const secondary = packet.generationAssets[i];
          await db.insert(assetPairingsTable).values({
            campaignId,
            primaryAssetId: primary.asset.id,
            secondaryAssetId: secondary.asset.id,
            templateId: campaign.templateId,
            platform: "all",
            usageCount: 1,
            firstPassApproved: null,
            finalStatus: "generated",
          });
        }
      } catch (err) {
        console.error("Failed to log asset pairings:", err instanceof Error ? err.message : err);
      }
    }

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

  if (variant.originalCaption && caption !== variant.originalCaption) {
    const [camp] = await db.select({ templateId: campaignsTable.templateId }).from(campaignsTable).where(eq(campaignsTable.id, campaignId));
    if (camp?.templateId) {
      await db.insert(refinementLogsTable).values({
        campaignId,
        templateId: camp.templateId,
        editType: "caption_edit",
        platform: variant.platform,
        aspectRatio: variant.aspectRatio,
        originalValue: variant.originalCaption,
        newValue: caption,
        userId: "system",
      });
    }
  }

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

        const [logoBuffer, fontFamily] = await Promise.all([
          fetchLogoBuffer(campaign.brandId),
          fetchBrandFontFamily(campaign.brandId),
        ]);

        const newComposited = await compositeImage({
          rawImageBuffer: rawBuffer,
          layoutSpec: ctx.template.layoutSpec as any,
          headlineText: headline,
          logoBuffer,
          width: config.width,
          height: config.height,
          fontFamily,
        });

        const compFilename = `${campaignId}_${variant.platform}_composited.png`;
        const compPath = path.join(UPLOADS_DIR, compFilename);
        fs.writeFileSync(compPath, newComposited);
        compositedUrl = `/api/files/generated/${compFilename}`;
      }
    } catch (err) {
      console.error("Failed to recomposite for headline update:", err instanceof Error ? err.message : err);
    }
  }

  const [updated] = await db.update(campaignVariantsTable)
    .set({ headlineText: headline, compositedImageUrl: compositedUrl, updatedAt: new Date() })
    .where(eq(campaignVariantsTable.id, variantId))
    .returning();

  if (variant.originalHeadline && headline !== variant.originalHeadline) {
    await db.insert(refinementLogsTable).values({
      campaignId,
      templateId: campaign.templateId,
      editType: "headline_edit",
      platform: variant.platform,
      aspectRatio: variant.aspectRatio,
      originalValue: variant.originalHeadline,
      newValue: headline,
      userId: "system",
    });
  }

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
    const selectedAssetIds = selectedAssets.map(a => a.assetId);

    let packet: Awaited<ReturnType<typeof buildGenerationPacket>> | null = null;
    let referenceImages: ReferenceImage[] = [];

    if (selectedAssetIds.length > 0) {
      packet = await buildGenerationPacket({
        campaignId,
        brandId: campaign.brandId,
        templateId: campaign.templateId,
        platform: variant.platform,
        selectedAssetIds,
      });
      referenceImages = await buildReferenceImages(packet);
    }

    const ctx = await assembleContext({
      brandId: campaign.brandId,
      templateId: campaign.templateId,
      selectedAssets,
      selectedHashtagSetIds: (campaign.selectedHashtagSets || []) as string[],
      briefText: instruction
        ? `${campaign.briefText || ""}\n\nADDITIONAL REFINEMENT: ${instruction}`
        : campaign.briefText || undefined,
      referenceAnalysis: campaign.referenceAnalysis as Record<string, unknown> | null,
      generationPacket: packet,
    });

    const imgResult = await generateImage(ctx, variant.platform, referenceImages);

    ensureDir(UPLOADS_DIR);

    const ts = Date.now();
    const rawFilename = `${campaignId}_${variant.platform}_${ts}_raw.png`;
    const rawPath = path.join(UPLOADS_DIR, rawFilename);
    fs.writeFileSync(rawPath, imgResult.imageBuffer);

    const layoutSpec = ctx.template.layoutSpec as Record<string, unknown> | null;
    const [logoBuffer, brandFontFamily] = await Promise.all([
      fetchLogoBuffer(campaign.brandId),
      fetchBrandFontFamily(campaign.brandId),
    ]);

    let compositedBuffer: Buffer;
    try {
      compositedBuffer = await compositeImage({
        rawImageBuffer: imgResult.imageBuffer,
        layoutSpec: layoutSpec as any,
        headlineText: variant.headlineText || null,
        logoBuffer,
        width: config.width,
        height: config.height,
        fontFamily: brandFontFamily,
      });
    } catch (err) {
      console.error(`Compositing failed during regeneration for ${variant.platform}, using raw image:`, err instanceof Error ? err.message : err);
      compositedBuffer = imgResult.imageBuffer;
    }

    const compFilename = `${campaignId}_${variant.platform}_${ts}_composited.png`;
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

    if (campaign.templateId) {
      await db.insert(refinementLogsTable).values({
        campaignId,
        templateId: campaign.templateId,
        editType: "image_refinement",
        platform: variant.platform,
        aspectRatio: variant.aspectRatio,
        refinementPrompt: instruction || null,
        userId: "system",
      });
    }

    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Regeneration failed: ${message}` });
  }
});

export default router;
