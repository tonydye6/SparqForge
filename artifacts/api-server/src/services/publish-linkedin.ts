import { logger } from "../lib/logger";

interface PublishLinkedInOptions {
  accessToken: string;
  authorUrn: string;
  text: string;
  imagePath?: string;
}

interface PublishResult {
  success: boolean;
  platformPostId?: string;
  error?: string;
}

async function uploadImage(accessToken: string, authorUrn: string, imagePath: string): Promise<string | null> {
  try {
    const fs = await import("fs");
    const path = await import("path");

    const fullPath = path.resolve(imagePath);
    if (!fs.existsSync(fullPath)) {
      logger.warn({ imagePath: fullPath }, "Image file not found for LinkedIn upload");
      return null;
    }

    const registerResp = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
          owner: authorUrn,
          serviceRelationships: [
            {
              relationshipType: "OWNER",
              identifier: "urn:li:userGeneratedContent",
            },
          ],
        },
      }),
    });

    if (!registerResp.ok) {
      const err = await registerResp.text();
      logger.error({ status: registerResp.status, body: err }, "LinkedIn register upload failed");
      return null;
    }

    const registerData = await registerResp.json() as {
      value: {
        uploadMechanism: {
          "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
            uploadUrl: string;
          };
        };
        asset: string;
      };
    };

    const uploadUrl = registerData.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;
    const asset = registerData.value.asset;

    const imageBuffer = fs.readFileSync(fullPath);
    const uploadResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: imageBuffer,
    });

    if (!uploadResp.ok) {
      const err = await uploadResp.text();
      logger.error({ status: uploadResp.status, body: err }, "LinkedIn image upload failed");
      return null;
    }

    return asset;
  } catch (err) {
    logger.error({ err }, "LinkedIn image upload error");
    return null;
  }
}

export async function publishToLinkedIn(options: PublishLinkedInOptions): Promise<PublishResult> {
  const { accessToken, authorUrn, text, imagePath } = options;

  try {
    let asset: string | null = null;

    if (imagePath) {
      asset = await uploadImage(accessToken, authorUrn, imagePath);
    }

    const postBody: Record<string, unknown> = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: asset ? "IMAGE" : "NONE",
          ...(asset && {
            media: [
              {
                status: "READY",
                media: asset,
              },
            ],
          }),
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    const resp = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(postBody),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      logger.error({ status: resp.status, body: errBody }, "LinkedIn post creation failed");
      return { success: false, error: `LinkedIn API error (${resp.status}): ${errBody}` };
    }

    const postId = resp.headers.get("x-restli-id") || "unknown";
    logger.info({ postId }, "LinkedIn post published successfully");
    return { success: true, platformPostId: postId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "LinkedIn publish error");
    return { success: false, error: message };
  }
}
