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

/** The account fields needed to route a post through a connected workspace account. */
export interface PublishingAccountRef {
  id: string;
  platform: string;
  brandId: string | null;
}

/**
 * Pick the connected workspace account that can publish an entry.
 *
 * Accounts are connected once for the workspace. The creative's brand only
 * selects a future brand-owned account when one exists; otherwise the first
 * compatible house account serves the post. Keeping this rule beside
 * `accountPlatformFor` gives every scheduling path the same answer.
 */
export function publishingAccountFor(
  accounts: readonly PublishingAccountRef[],
  entryPlatform: string,
  preferredBrandId: string | null,
): PublishingAccountRef | undefined {
  const accountPlatform = accountPlatformFor(entryPlatform);
  const compatible = accounts.filter((account) => account.platform === accountPlatform);
  if (preferredBrandId) {
    const ownBrand = compatible.find((account) => account.brandId === preferredBrandId);
    if (ownBrand) return ownBrand;
  }
  return compatible[0];
}

/** Unique connected account platforms available to every brand in the workspace. */
export function workspaceAccountPlatforms(
  accounts: readonly Pick<PublishingAccountRef, "platform">[],
): string[] {
  return [...new Set(accounts.map((account) => account.platform.trim()).filter(Boolean))];
}
