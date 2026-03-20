import { logger } from "../lib/logger";

interface PublishTwitterOptions {
  accessToken: string;
  text: string;
  imageUrl?: string;
  imagePath?: string;
}

interface PublishResult {
  success: boolean;
  platformPostId?: string;
  error?: string;
}

async function uploadMedia(accessToken: string, imagePath: string): Promise<string | null> {
  try {
    const fs = await import("fs");
    const path = await import("path");

    const fullPath = path.resolve(imagePath);
    if (!fs.existsSync(fullPath)) {
      logger.warn({ imagePath: fullPath }, "Image file not found for Twitter upload");
      return null;
    }

    const imageBuffer = fs.readFileSync(fullPath);
    const base64 = imageBuffer.toString("base64");
    const mimeType = fullPath.endsWith(".png") ? "image/png" : "image/jpeg";

    const initResp = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        command: "INIT",
        total_bytes: String(imageBuffer.length),
        media_type: mimeType,
      }),
    });

    if (!initResp.ok) {
      const err = await initResp.text();
      logger.error({ status: initResp.status, body: err }, "Twitter media INIT failed");
      return null;
    }

    const initData = await initResp.json() as { media_id_string: string };
    const mediaId = initData.media_id_string;

    const appendResp = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        command: "APPEND",
        media_id: mediaId,
        segment_index: "0",
        media_data: base64,
      }),
    });

    if (!appendResp.ok) {
      const err = await appendResp.text();
      logger.error({ status: appendResp.status, body: err }, "Twitter media APPEND failed");
      return null;
    }

    const finalizeResp = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        command: "FINALIZE",
        media_id: mediaId,
      }),
    });

    if (!finalizeResp.ok) {
      const err = await finalizeResp.text();
      logger.error({ status: finalizeResp.status, body: err }, "Twitter media FINALIZE failed");
      return null;
    }

    return mediaId;
  } catch (err) {
    logger.error({ err }, "Twitter media upload error");
    return null;
  }
}

export async function publishToTwitter(options: PublishTwitterOptions): Promise<PublishResult> {
  const { accessToken, text, imagePath } = options;

  try {
    let mediaIds: string[] = [];

    if (imagePath) {
      const mediaId = await uploadMedia(accessToken, imagePath);
      if (mediaId) {
        mediaIds = [mediaId];
      }
    }

    const tweetBody: Record<string, unknown> = { text };
    if (mediaIds.length > 0) {
      tweetBody.media = { media_ids: mediaIds };
    }

    const resp = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tweetBody),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      logger.error({ status: resp.status, body: errBody }, "Twitter tweet creation failed");
      return { success: false, error: `Twitter API error (${resp.status}): ${errBody}` };
    }

    const data = await resp.json() as { data: { id: string } };
    logger.info({ tweetId: data.data.id }, "Tweet published successfully");
    return { success: true, platformPostId: data.data.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "Twitter publish error");
    return { success: false, error: message };
  }
}
