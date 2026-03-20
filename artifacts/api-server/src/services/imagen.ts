import { ai } from "@workspace/integrations-gemini-ai";
import { Modality } from "@google/genai";
import type { AssembledContext } from "./context-assembly.js";

export const PLATFORM_CONFIGS: Record<string, { platform: string; aspectRatio: string; width: number; height: number }> = {
  instagram_feed: { platform: "instagram_feed", aspectRatio: "1:1", width: 1080, height: 1080 },
  instagram_story: { platform: "instagram_story", aspectRatio: "9:16", width: 1080, height: 1920 },
  twitter: { platform: "twitter", aspectRatio: "16:9", width: 1200, height: 675 },
  linkedin: { platform: "linkedin", aspectRatio: "16:9", width: 1200, height: 628 },
  tiktok: { platform: "tiktok", aspectRatio: "9:16", width: 1080, height: 1920 },
};

function buildImagePrompt(ctx: AssembledContext): string {
  const parts: string[] = [];

  if (ctx.brand.imagenPrefix) {
    parts.push(ctx.brand.imagenPrefix);
  }

  if (ctx.template.imagenPromptAddition) {
    parts.push(ctx.template.imagenPromptAddition);
  }

  if (ctx.combinedBrief) {
    parts.push(ctx.combinedBrief);
  }

  if (ctx.referenceAnalysis) {
    const ref = ctx.referenceAnalysis as Record<string, string>;
    let refText = "REFERENCE INSPIRATION:";
    if (ref.visual_mood) refText += ` Visual mood: ${ref.visual_mood}.`;
    if (ref.color_strategy) refText += ` Color approach: ${typeof ref.color_strategy === 'string' ? ref.color_strategy : JSON.stringify(ref.color_strategy)}.`;
    parts.push(refText);
  }

  parts.push("Do not include any text, words, or letters in the image. No watermarks.");

  return parts.join("\n\n");
}

export interface ImageGenerationResult {
  platform: string;
  aspectRatio: string;
  imageBuffer: Buffer;
  mimeType: string;
}

export async function generateImage(
  ctx: AssembledContext,
  platformKey: string,
): Promise<ImageGenerationResult> {
  const config = PLATFORM_CONFIGS[platformKey];
  if (!config) throw new Error(`Unknown platform: ${platformKey}`);

  const prompt = buildImagePrompt(ctx);
  const fullPrompt = `${prompt}\n\nGenerate this as a ${config.aspectRatio} aspect ratio image suitable for ${config.platform.replace(/_/g, " ")}.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData
  );

  if (!imagePart?.inlineData?.data) {
    throw new Error(`No image data in response for ${platformKey}`);
  }

  return {
    platform: config.platform,
    aspectRatio: config.aspectRatio,
    imageBuffer: Buffer.from(imagePart.inlineData.data, "base64"),
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}

export async function generateAllImages(
  ctx: AssembledContext,
  platforms: string[],
  onProgress?: (platform: string, status: "started" | "completed" | "failed", error?: string) => void,
): Promise<ImageGenerationResult[]> {
  const results: ImageGenerationResult[] = [];

  const promises = platforms.map(async (platform) => {
    onProgress?.(platform, "started");
    try {
      const result = await generateImage(ctx, platform);
      onProgress?.(platform, "completed");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onProgress?.(platform, "failed", message);
      return null;
    }
  });

  const settled = await Promise.allSettled(promises);
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      results.push(result.value);
    }
  }

  return results;
}

export function estimateImagenCost(imageCount: number): number {
  return imageCount * 0.06;
}
