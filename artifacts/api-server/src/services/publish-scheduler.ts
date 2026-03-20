import { eq, and, lte, or } from "drizzle-orm";
import { db, calendarEntriesTable, campaignVariantsTable, socialAccountsTable } from "@workspace/db";
import { publishToTwitter } from "./publish-twitter";
import { publishToInstagram } from "./publish-instagram";
import { publishToLinkedIn } from "./publish-linkedin";
import { decryptToken } from "./token-encryption";
import { logger } from "../lib/logger";

const POLL_INTERVAL_MS = 60_000;
const MAX_RETRIES = 3;

function getBackoffMs(retryCount: number): number {
  return Math.min(60_000 * Math.pow(2, retryCount), 15 * 60_000);
}

function getPublicImageUrl(compositedImageUrl: string | null): string | null {
  if (!compositedImageUrl) return null;
  const domain = process.env["REPLIT_DEV_DOMAIN"] || process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (!domain) return null;
  return `https://${domain}${compositedImageUrl}`;
}

function getImageFilePath(compositedImageUrl: string | null): string | null {
  if (!compositedImageUrl) return null;
  const filename = compositedImageUrl.split("/").pop();
  if (!filename) return null;
  return `uploads/generated/${filename}`;
}

async function publishEntry(entryId: string): Promise<void> {
  const [entry] = await db.select().from(calendarEntriesTable).where(eq(calendarEntriesTable.id, entryId));
  if (!entry) {
    logger.warn({ entryId }, "Calendar entry not found for publishing");
    return;
  }

  const [updated] = await db.update(calendarEntriesTable)
    .set({ publishStatus: "publishing", updatedAt: new Date() })
    .where(and(
      eq(calendarEntriesTable.id, entryId),
      or(
        eq(calendarEntriesTable.publishStatus, "scheduled"),
        eq(calendarEntriesTable.publishStatus, "failed")
      )
    ))
    .returning();

  if (!updated) {
    logger.info({ entryId }, "Entry already being processed, skipping");
    return;
  }

  const newRetryCount = (entry.retryCount || 0) + 1;

  if (!entry.socialAccountId) {
    await db.update(calendarEntriesTable)
      .set({
        publishStatus: "failed",
        publishError: "No social account connected for this entry",
        retryCount: newRetryCount,
        updatedAt: new Date(),
      })
      .where(eq(calendarEntriesTable.id, entryId));
    return;
  }

  const [socialAccount] = await db.select().from(socialAccountsTable)
    .where(eq(socialAccountsTable.id, entry.socialAccountId));

  if (!socialAccount) {
    await db.update(calendarEntriesTable)
      .set({
        publishStatus: "failed",
        publishError: "Social account not found",
        retryCount: newRetryCount,
        updatedAt: new Date(),
      })
      .where(eq(calendarEntriesTable.id, entryId));
    return;
  }

  const platformMap: Record<string, string> = {
    twitter: "twitter",
    instagram_feed: "instagram",
    instagram_story: "instagram",
    linkedin: "linkedin",
  };
  const expectedPlatform = platformMap[entry.platform] || entry.platform;
  if (socialAccount.platform !== expectedPlatform && socialAccount.platform !== entry.platform) {
    await db.update(calendarEntriesTable)
      .set({
        publishStatus: "failed",
        publishError: `Platform mismatch: entry is ${entry.platform} but account is ${socialAccount.platform}`,
        retryCount: newRetryCount,
        updatedAt: new Date(),
      })
      .where(eq(calendarEntriesTable.id, entryId));
    return;
  }

  const [variant] = await db.select().from(campaignVariantsTable)
    .where(eq(campaignVariantsTable.id, entry.variantId));

  if (!variant) {
    await db.update(calendarEntriesTable)
      .set({
        publishStatus: "failed",
        publishError: "Campaign variant not found",
        retryCount: newRetryCount,
        updatedAt: new Date(),
      })
      .where(eq(calendarEntriesTable.id, entryId));
    return;
  }

  const caption = variant.caption || "";
  const imagePath = getImageFilePath(variant.compositedImageUrl);
  const publicImageUrl = getPublicImageUrl(variant.compositedImageUrl);

  let result: { success: boolean; platformPostId?: string; error?: string };

  const platform = entry.platform;
  let decryptedAccessToken: string;
  try {
    decryptedAccessToken = decryptToken(socialAccount.accessToken);
  } catch (err) {
    result = { success: false, error: "Failed to decrypt access token" };
    await db.update(calendarEntriesTable)
      .set({
        publishStatus: "failed",
        publishError: result.error,
        retryCount: newRetryCount,
        updatedAt: new Date(),
      })
      .where(eq(calendarEntriesTable.id, entryId));
    return;
  }

  try {
    if (platform === "twitter") {
      result = await publishToTwitter({
        accessToken: decryptedAccessToken,
        text: caption,
        imagePath: imagePath || undefined,
      });
    } else if (platform === "instagram_feed" || platform === "instagram_story") {
      if (!publicImageUrl) {
        result = { success: false, error: "No public image URL available for Instagram" };
      } else {
        result = await publishToInstagram({
          accessToken: decryptedAccessToken,
          igUserId: socialAccount.accountId,
          caption,
          imageUrl: publicImageUrl,
        });
      }
    } else if (platform === "linkedin") {
      result = await publishToLinkedIn({
        accessToken: decryptedAccessToken,
        authorUrn: socialAccount.accountId,
        text: caption,
        imagePath: imagePath || undefined,
      });
    } else {
      result = { success: false, error: `Unsupported platform: ${platform}` };
    }
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : "Unknown publish error" };
  }

  if (result.success) {
    await db.update(calendarEntriesTable)
      .set({
        publishStatus: "published",
        publishedAt: new Date(),
        publishError: null,
        updatedAt: new Date(),
      })
      .where(eq(calendarEntriesTable.id, entryId));
    logger.info({ entryId, platform, postId: result.platformPostId }, "Entry published successfully");
  } else {
    await db.update(calendarEntriesTable)
      .set({
        publishStatus: "failed",
        publishError: result.error || "Unknown error",
        retryCount: newRetryCount,
        updatedAt: new Date(),
      })
      .where(eq(calendarEntriesTable.id, entryId));
    logger.warn({ entryId, platform, error: result.error, retryCount: newRetryCount }, "Entry publish failed");
  }
}

async function pollAndPublish(): Promise<void> {
  try {
    const now = new Date();

    const readyEntries = await db.select()
      .from(calendarEntriesTable)
      .where(
        and(
          lte(calendarEntriesTable.scheduledAt, now),
          eq(calendarEntriesTable.publishStatus, "scheduled")
        )
      );

    const failedEntries = await db.select()
      .from(calendarEntriesTable)
      .where(eq(calendarEntriesTable.publishStatus, "failed"));

    const retriableEntries = failedEntries.filter(entry => {
      if ((entry.retryCount || 0) >= MAX_RETRIES) return false;
      if (!entry.socialAccountId) return false;
      const backoffMs = getBackoffMs(entry.retryCount || 0);
      const lastAttempt = entry.updatedAt || entry.createdAt;
      return (now.getTime() - lastAttempt.getTime()) >= backoffMs;
    });

    const allEntries = [...readyEntries, ...retriableEntries];

    if (allEntries.length === 0) return;

    logger.info({ count: allEntries.length, ready: readyEntries.length, retries: retriableEntries.length }, "Processing entries for publishing");

    for (const entry of allEntries) {
      await publishEntry(entry.id);
    }
  } catch (err) {
    logger.error({ err }, "Publish scheduler poll error");
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startPublishScheduler(): void {
  if (intervalId) {
    logger.warn("Publish scheduler already running");
    return;
  }

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Starting publish scheduler");
  intervalId = setInterval(pollAndPublish, POLL_INTERVAL_MS);

  pollAndPublish();
}

export function stopPublishScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("Publish scheduler stopped");
  }
}

export { publishEntry };
