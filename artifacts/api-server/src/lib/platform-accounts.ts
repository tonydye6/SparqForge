/**
 * Mapping from a calendar entry's platform to the social-account platform that
 * publishes it. Instagram feed and story posts both publish through the single
 * connected "instagram" account; every other platform maps to itself.
 *
 * Single source of truth: the publish scheduler enforces this at publish time,
 * so any code path that CREATES a calendar entry must resolve the account with
 * the same mapping. A path that skips it produces entries the publisher can
 * never send (and, because auto-retry requires a socialAccountId, never retries
 * either) — which is exactly how smart-scheduled entries used to fail.
 */
export const ACCOUNT_PLATFORM_MAP: Record<string, string> = {
  twitter:         "twitter",
  instagram_feed:  "instagram",
  instagram_story: "instagram",
  linkedin:        "linkedin",
  tiktok:          "tiktok",
  youtube:         "youtube",
};

/** The social-account platform that publishes a given entry platform. */
export function accountPlatformFor(entryPlatform: string): string {
  return ACCOUNT_PLATFORM_MAP[entryPlatform] ?? entryPlatform;
}
