import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, campaignsTable, campaignVariantsTable, costLogsTable } from "@workspace/db";
import { assembleContext, type SelectedAssetRef } from "../services/context-assembly.js";
import { generateVideo, estimateVideoCost, VIDEO_CONFIGS } from "../services/video-generation.js";
import { generateMusic, generateSFX, estimateElevenLabsCost } from "../services/elevenlabs.js";
import { mergeAudioVideo, type MergeMode } from "../services/audio-merge.js";
import * as fs from "fs";
import * as path from "path";
import multer from "multer";

const router: IRouter = Router();
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads", "generated");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only MP3 and WAV audio files are allowed"));
    }
  },
});

router.post("/campaigns/:id/generate-video", async (req: Request, res: Response): Promise<void> => {
  const campaignId = req.params.id;
  const { orientations } = req.body;

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
    const validOrientations = ["landscape", "portrait"];
    const rawOrientations = orientations || ["landscape", "portrait"];
    const selectedOrientations: Array<"landscape" | "portrait"> = (Array.isArray(rawOrientations) ? rawOrientations : [rawOrientations]).filter(
      (o: string) => validOrientations.includes(o)
    ) as Array<"landscape" | "portrait">;
    if (selectedOrientations.length === 0) {
      sendEvent("error", { message: "No valid orientations specified" });
      res.end();
      return;
    }

    sendEvent("progress", { step: "context", message: "Assembling context..." });
    const selectedAssets = (campaign.selectedAssets || []) as SelectedAssetRef[];
    const ctx = await assembleContext({
      brandId: campaign.brandId,
      templateId: campaign.templateId,
      selectedAssets,
      selectedHashtagSetIds: (campaign.selectedHashtagSets || []) as string[],
      briefText: campaign.briefText || undefined,
      referenceAnalysis: campaign.referenceAnalysis as Record<string, unknown> | null,
    });

    ensureDir(UPLOADS_DIR);

    for (const orientation of selectedOrientations) {
      sendEvent("video_progress", { orientation, status: "started", message: `Generating ${orientation} video...` });

      try {
        const result = await generateVideo(ctx, orientation);

        const videoFilename = `${campaignId}_video_${orientation}_${Date.now()}.mp4`;
        const videoPath = path.join(UPLOADS_DIR, videoFilename);
        fs.writeFileSync(videoPath, result.videoBuffer);

        const videoUrl = `/api/files/generated/${videoFilename}`;

        const platform = orientation === "landscape" ? "twitter" : "instagram_story";
        const existingVariants = await db.select().from(campaignVariantsTable)
          .where(eq(campaignVariantsTable.campaignId, campaignId));

        const matchingVariant = existingVariants.find(v => v.platform === platform);

        if (matchingVariant) {
          await db.update(campaignVariantsTable)
            .set({ videoUrl, audioSource: "veo_native", updatedAt: new Date() })
            .where(eq(campaignVariantsTable.id, matchingVariant.id));
        } else {
          await db.insert(campaignVariantsTable).values({
            campaignId,
            platform: `video_${orientation}`,
            aspectRatio: result.aspectRatio,
            videoUrl,
            audioSource: "veo_native",
            caption: "",
            status: "generated",
          });
        }

        sendEvent("video_progress", { orientation, status: "completed", videoUrl });

        const cost = estimateVideoCost(1);
        await db.insert(costLogsTable).values({
          campaignId,
          service: "gemini",
          operation: "video_generation",
          model: "veo-2.0-generate-001",
          costUsd: cost,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendEvent("video_progress", { orientation, status: "failed", error: message });
      }
    }

    sendEvent("complete", { message: "Video generation complete!" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendEvent("error", { message: `Video generation failed: ${message}` });
  } finally {
    res.end();
  }
});

router.post("/campaigns/:id/variants/:variantId/audio", async (req: Request, res: Response): Promise<void> => {
  const { id: campaignId, variantId } = req.params;
  const { type, prompt, mode, audioVolume, videoVolume } = req.body;

  const [variant] = await db.select().from(campaignVariantsTable)
    .where(eq(campaignVariantsTable.id, variantId));
  if (!variant || variant.campaignId !== campaignId) {
    res.status(404).json({ error: "Variant not found" });
    return;
  }

  if (!variant.videoUrl) {
    res.status(400).json({ error: "Variant has no video to add audio to" });
    return;
  }

  const validTypes = ["music", "sfx", "mute", "veo_native"];
  if (type && !validTypes.includes(type)) {
    res.status(400).json({ error: `Invalid audio type. Must be one of: ${validTypes.join(", ")}` });
    return;
  }

  const validModes = ["replace", "mix"];
  if (mode && !validModes.includes(mode)) {
    res.status(400).json({ error: `Invalid merge mode. Must be one of: ${validModes.join(", ")}` });
    return;
  }

  if ((type === "music" || type === "sfx") && !prompt) {
    res.status(400).json({ error: `A prompt is required for ${type} audio generation` });
    return;
  }

  try {
    let audioBuffer: Buffer | undefined;
    let audioSource = type || "veo_native";

    if (type === "music" && prompt) {
      const result = await generateMusic(prompt);
      audioBuffer = result.audioBuffer;
      audioSource = "elevenlabs_music";
    } else if (type === "sfx" && prompt) {
      const result = await generateSFX(prompt);
      audioBuffer = result.audioBuffer;
      audioSource = "elevenlabs_sfx";
    } else if (type === "mute") {
      audioSource = "mute";
    }

    ensureDir(UPLOADS_DIR);

    let audioUrl: string | null = null;
    if (audioBuffer) {
      const audioFilename = `${campaignId}_${variantId}_audio_${Date.now()}.mp3`;
      const audioPath = path.join(UPLOADS_DIR, audioFilename);
      fs.writeFileSync(audioPath, audioBuffer);
      audioUrl = `/api/files/generated/${audioFilename}`;

      await db.insert(costLogsTable).values({
        campaignId,
        service: "elevenlabs",
        operation: type === "music" ? "music_generation" : "sfx_generation",
        model: "elevenlabs",
        costUsd: estimateElevenLabsCost(),
      });
    }

    const videoFilename = variant.videoUrl.replace("/api/files/generated/", "");
    const videoPath = path.join(UPLOADS_DIR, videoFilename);

    if (!fs.existsSync(videoPath)) {
      res.status(400).json({ error: "Video file not found" });
      return;
    }

    const videoBuffer = fs.readFileSync(videoPath);
    const mergeMode: MergeMode = type === "mute" ? "mute" : (mode || "replace") as MergeMode;

    const mergedBuffer = await mergeAudioVideo({
      videoBuffer,
      audioBuffer,
      mode: mergeMode,
      audioVolume: audioVolume ?? 1.0,
      videoVolume: videoVolume ?? 0.3,
    });

    const mergedFilename = `${campaignId}_${variantId}_merged_${Date.now()}.mp4`;
    const mergedPath = path.join(UPLOADS_DIR, mergedFilename);
    fs.writeFileSync(mergedPath, mergedBuffer);
    const mergedVideoUrl = `/api/files/generated/${mergedFilename}`;

    const [updated] = await db.update(campaignVariantsTable)
      .set({
        audioSource,
        audioUrl,
        mergedVideoUrl,
        updatedAt: new Date(),
      })
      .where(eq(campaignVariantsTable.id, variantId))
      .returning();

    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Audio processing failed: ${message}` });
  }
});

router.post("/campaigns/:id/variants/:variantId/audio-upload", audioUpload.single("audio"), async (req: Request, res: Response): Promise<void> => {
  const { id: campaignId, variantId } = req.params;
  const mode = (req.body?.mode || "replace") as MergeMode;

  const [variant] = await db.select().from(campaignVariantsTable)
    .where(eq(campaignVariantsTable.id, variantId));
  if (!variant || variant.campaignId !== campaignId) {
    res.status(404).json({ error: "Variant not found" });
    return;
  }

  if (!variant.videoUrl) {
    res.status(400).json({ error: "Variant has no video" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  try {
    ensureDir(UPLOADS_DIR);

    const audioFilename = `${campaignId}_${variantId}_custom_${Date.now()}.mp3`;
    const audioPath = path.join(UPLOADS_DIR, audioFilename);
    fs.writeFileSync(audioPath, req.file.buffer);
    const audioUrl = `/api/files/generated/${audioFilename}`;

    const videoFilename = variant.videoUrl.replace("/api/files/generated/", "");
    const videoPath = path.join(UPLOADS_DIR, videoFilename);

    if (!fs.existsSync(videoPath)) {
      res.status(400).json({ error: "Video file not found" });
      return;
    }

    const videoBuffer = fs.readFileSync(videoPath);

    const mergedBuffer = await mergeAudioVideo({
      videoBuffer,
      audioBuffer: req.file.buffer,
      mode,
    });

    const mergedFilename = `${campaignId}_${variantId}_merged_${Date.now()}.mp4`;
    const mergedPath = path.join(UPLOADS_DIR, mergedFilename);
    fs.writeFileSync(mergedPath, mergedBuffer);
    const mergedVideoUrl = `/api/files/generated/${mergedFilename}`;

    const [updated] = await db.update(campaignVariantsTable)
      .set({
        audioSource: "custom_upload",
        audioUrl,
        mergedVideoUrl,
        updatedAt: new Date(),
      })
      .where(eq(campaignVariantsTable.id, variantId))
      .returning();

    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Audio upload failed: ${message}` });
  }
});

export default router;
