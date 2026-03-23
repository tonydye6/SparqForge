import { logger } from "../lib/logger";

interface PublishInstagramOptions {
  accessToken: string;
  igUserId: string;
  caption: string;
  imageUrl: string;
  platform?: string;
}

interface PublishResult {
  success: boolean;
  platformPostId?: string;
  error?: string;
  httpStatus?: number;
}

function resolvePublicImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  const appUrl = process.env.APP_URL;
  if (appUrl) {
    return `${appUrl.replace(/\/$/, "")}${imageUrl}`;
  }

  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) {
    return `https://${devDomain}${imageUrl}`;
  }

  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const firstDomain = domains.split(",")[0].trim();
    if (firstDomain) {
      return `https://${firstDomain}${imageUrl}`;
    }
  }

  return imageUrl;
}

async function waitForContainer(containerId: string, accessToken: string): Promise<{ ready: boolean; error?: string }> {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 3000));

    const statusResp = await fetch(
      `https://graph.facebook.com/v19.0/${containerId}?fields=status_code`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (statusResp.ok) {
      const statusData = await statusResp.json() as { status_code: string };
      if (statusData.status_code === "FINISHED") {
        return { ready: true };
      }
      if (statusData.status_code === "ERROR") {
        return { ready: false, error: "Instagram media container processing failed" };
      }
    }
    attempts++;
  }

  return { ready: false, error: "Instagram media container processing timed out" };
}

async function createFeedContainer(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
  caption: string,
): Promise<{ id: string } | { error: string; httpStatus?: number }> {
  const resp = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
      }),
    },
  );

  if (!resp.ok) {
    const errBody = await resp.text();
    logger.error({ status: resp.status, body: errBody }, "Instagram feed container creation failed");
    return { error: `Instagram API error (${resp.status}): ${errBody}`, httpStatus: resp.status };
  }

  return await resp.json() as { id: string };
}

async function createStoryContainer(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
): Promise<{ id: string } | { error: string; httpStatus?: number }> {
  const resp = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        image_url: imageUrl,
        media_type: "STORIES",
      }),
    },
  );

  if (!resp.ok) {
    const errBody = await resp.text();
    logger.error({ status: resp.status, body: errBody }, "Instagram story container creation failed");
    return { error: `Instagram API error (${resp.status}): ${errBody}`, httpStatus: resp.status };
  }

  return await resp.json() as { id: string };
}

export async function publishToInstagram(options: PublishInstagramOptions): Promise<PublishResult> {
  const { accessToken, igUserId, caption, platform } = options;
  const publicImageUrl = resolvePublicImageUrl(options.imageUrl);
  const isStory = platform === "instagram_story";

  try {
    let containerResult: { id: string } | { error: string };

    if (isStory) {
      containerResult = await createStoryContainer(igUserId, accessToken, publicImageUrl);
    } else {
      containerResult = await createFeedContainer(igUserId, accessToken, publicImageUrl, caption);
    }

    if ("error" in containerResult) {
      return { success: false, error: containerResult.error, httpStatus: containerResult.httpStatus };
    }

    const containerId = containerResult.id;

    const containerStatus = await waitForContainer(containerId, accessToken);
    if (!containerStatus.ready) {
      return { success: false, error: containerStatus.error };
    }

    const publishResp = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          creation_id: containerId,
        }),
      },
    );

    if (!publishResp.ok) {
      const errBody = await publishResp.text();
      logger.error({ status: publishResp.status, body: errBody }, "Instagram publish failed");
      return { success: false, error: `Instagram publish error (${publishResp.status}): ${errBody}`, httpStatus: publishResp.status };
    }

    const publishData = await publishResp.json() as { id: string };
    const postType = isStory ? "story" : "post";
    logger.info({ postId: publishData.id, postType }, `Instagram ${postType} published successfully`);
    return { success: true, platformPostId: publishData.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "Instagram publish error");
    return { success: false, error: message };
  }
}
