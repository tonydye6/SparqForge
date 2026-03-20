import { logger } from "../lib/logger";

interface PublishInstagramOptions {
  accessToken: string;
  igUserId: string;
  caption: string;
  imageUrl: string;
}

interface PublishResult {
  success: boolean;
  platformPostId?: string;
  error?: string;
}

export async function publishToInstagram(options: PublishInstagramOptions): Promise<PublishResult> {
  const { accessToken, igUserId, caption, imageUrl } = options;

  try {
    const containerResp = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          caption,
          access_token: accessToken,
        }),
      }
    );

    if (!containerResp.ok) {
      const errBody = await containerResp.text();
      logger.error({ status: containerResp.status, body: errBody }, "Instagram container creation failed");
      return { success: false, error: `Instagram API error (${containerResp.status}): ${errBody}` };
    }

    const containerData = await containerResp.json() as { id: string };
    const containerId = containerData.id;

    let attempts = 0;
    const maxAttempts = 10;
    let containerReady = false;
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 3000));

      const statusResp = await fetch(
        `https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${accessToken}`
      );
      if (statusResp.ok) {
        const statusData = await statusResp.json() as { status_code: string };
        if (statusData.status_code === "FINISHED") {
          containerReady = true;
          break;
        }
        if (statusData.status_code === "ERROR") {
          return { success: false, error: "Instagram media container processing failed" };
        }
      }
      attempts++;
    }

    if (!containerReady) {
      return { success: false, error: "Instagram media container processing timed out" };
    }

    const publishResp = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: accessToken,
        }),
      }
    );

    if (!publishResp.ok) {
      const errBody = await publishResp.text();
      logger.error({ status: publishResp.status, body: errBody }, "Instagram publish failed");
      return { success: false, error: `Instagram publish error (${publishResp.status}): ${errBody}` };
    }

    const publishData = await publishResp.json() as { id: string };
    logger.info({ postId: publishData.id }, "Instagram post published successfully");
    return { success: true, platformPostId: publishData.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "Instagram publish error");
    return { success: false, error: message };
  }
}
