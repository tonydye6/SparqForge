/**
 * The one answer to "which channels is this post for".
 *
 * THE BUG THIS EXISTS TO KILL. Three surfaces in the Studio each decided this
 * for themselves and gave three different answers on the same post:
 *
 *   stage 01  read connected accounts
 *   stage 04  hardcoded instagram_feed, twitter, linkedin, tiktok
 *   stage 05  hardcoded instagram_feed, instagram_story, tiktok, twitter
 *
 * So a post got LinkedIn copy that could never publish, and an Instagram Story
 * crop that nothing had written copy for. Whichever set is right, three cannot
 * be.
 *
 * THE RULE, corrected by Tony 2026-08-10: a channel exists for this post if
 * ANY connected account in the workspace can publish it. The first version
 * scoped accounts to the post's brand, which quietly narrowed Crown U to one
 * channel; the real model is that every brand currently publishes through the
 * Sparq Games accounts, brand-owned accounts arrive later, and the user picks
 * the account per post. So the CHANNEL comes from the workspace, the DEFAULT
 * account prefers the post's own brand, and the choice is always the user's.
 *
 * Pure, and runnable under tsx like the other services carrying invariants.
 */

import { ACCOUNT_PLATFORM_MAP } from "../lib/platform-accounts.js";
import { PLATFORM_COPY_RULES } from "./copy-stage.js";
import { CROP_TARGETS } from "./crop-stage.js";

/** A connected account, as the resolver needs to see it. */
export interface AccountRef {
  id: string;
  /** Social-account platform: "instagram", not "instagram_feed". */
  platform: string;
  accountName: string | null;
  /** Storage owner. House accounts use the Sparq brand id; legacy rows may be null. */
  brandId: string | null;
}

/** One account that could publish a channel, ready for a picker. */
export interface ChannelAccount {
  id: string;
  accountName: string | null;
  brandId: string | null;
  /** True when this account belongs to the post's own brand. */
  ownBrand: boolean;
}

export interface Channel {
  /** The calendar-entry platform. What a variant and an entry are keyed by. */
  platform: string;
  label: string;
  /** The social-account platform that publishes it. Instagram serves feed AND story. */
  accountPlatform: string;
  /**
   * Every connected account that could publish this channel, own-brand first.
   *
   * Plural because that is the real state: today every brand posts through
   * the Sparq Games accounts, and later brands gain their own, at which point
   * the same channel has two eligible accounts and somebody has to choose.
   */
  accounts: ChannelAccount[];
  /**
   * The account this channel publishes through unless the user picks another.
   * The post's own brand's account when one exists, otherwise the house one.
   */
  defaultAccountId: string;
  /** What a variant made for this channel should be shaped as. */
  aspectLabel: string;
  /**
   * Whether the crop stage knows this placement at all.
   *
   * DISTINCT FROM `hasSafeAreas`, and the distinction is load-bearing. The
   * Instagram feed and X have NO safe areas because their chrome genuinely
   * sits outside the picture; that is a verified fact. LinkedIn and YouTube
   * have none because nobody has mapped them. Treating those two as the same
   * state warns about the wrong channels and stays silent about the right
   * ones, which is exactly what the first version of this did.
   */
  furnitureMapped: boolean;
  /** Whether this placement draws chrome OVER the picture that a crop must dodge. */
  hasSafeAreas: boolean;
  /** Whether per-channel copy limits are known for this placement. */
  hasCopyRules: boolean;
}

/**
 * Reading order, fixed so the three surfaces list channels the same way.
 * Feed placements first, because that is where most posts go.
 */
const CHANNEL_ORDER = [
  "instagram_feed",
  "instagram_story",
  "twitter",
  "tiktok",
  "linkedin",
  "youtube",
] as const;

const CHANNEL_LABELS: Record<string, string> = {
  instagram_feed: "Instagram feed",
  instagram_story: "Instagram story",
  twitter: "X",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
};

/**
 * Aspect for the placements the crop stage has no verified furniture for.
 *
 * Deliberately conservative rather than invented. A LinkedIn feed image is
 * accepted at several ratios and 1:1 is the one that survives all of them;
 * YouTube is a video surface and 16:9 is not a judgement call. Anything the
 * crop stage DOES know is taken from `CROP_TARGETS` instead of listed here, so
 * there is one place that can be wrong rather than two.
 */
const FALLBACK_ASPECT: Record<string, string> = {
  linkedin: "1:1",
  youtube: "16:9",
};

/**
 * Every channel this post can actually publish to, given the WORKSPACE's
 * connected accounts.
 *
 * One account can serve more than one placement (Instagram serves the feed and
 * the story), which is why this is an expansion rather than a filter, and why
 * it reads `ACCOUNT_PLATFORM_MAP` backwards instead of keeping a second copy
 * of that relationship.
 *
 * Ordering inside a channel's account list is the default rule made visible:
 * the post's own brand's accounts first, then the rest. `defaultAccountId` is
 * simply the first entry, so the picker and the default can never disagree.
 */
export function resolveChannels(accounts: readonly AccountRef[], brandId: string | null): Channel[] {
  const cropByPlatform = new Map(CROP_TARGETS.map((t) => [t.platform, t]));

  const byAccountPlatform = new Map<string, AccountRef[]>();
  for (const account of accounts) {
    const platform = account.platform.trim();
    if (!platform) continue;
    const list = byAccountPlatform.get(platform) ?? [];
    // One account can be handed in twice by a sloppy caller; a duplicate id in
    // a picker is a duplicate React key and a double-counted default.
    if (!list.some((a) => a.id === account.id)) list.push(account);
    byAccountPlatform.set(platform, list);
  }

  return CHANNEL_ORDER.filter((platform) =>
    byAccountPlatform.has(ACCOUNT_PLATFORM_MAP[platform] ?? platform),
  ).map((platform) => {
    const crop = cropByPlatform.get(platform);
    const eligible = byAccountPlatform.get(ACCOUNT_PLATFORM_MAP[platform] ?? platform)!;
    const ranked: ChannelAccount[] = [...eligible]
      .map((a) => ({
        id: a.id,
        accountName: a.accountName,
        brandId: a.brandId,
        ownBrand: brandId !== null && a.brandId === brandId,
      }))
      .sort((a, b) => Number(b.ownBrand) - Number(a.ownBrand));

    return {
      platform,
      label: CHANNEL_LABELS[platform] ?? platform,
      accountPlatform: ACCOUNT_PLATFORM_MAP[platform] ?? platform,
      accounts: ranked,
      defaultAccountId: ranked[0]!.id,
      aspectLabel: crop?.aspectLabel ?? FALLBACK_ASPECT[platform] ?? "1:1",
      furnitureMapped: crop !== undefined,
      hasSafeAreas: (crop?.safeAreas.length ?? 0) > 0,
      hasCopyRules: platform in PLATFORM_COPY_RULES,
    };
  });
}

/**
 * What to say when the workspace has no connected account at all.
 *
 * One constant because three surfaces need the same sentence, and because
 * "no channels" is the single most consequential state in the Studio: nothing
 * made can go anywhere until it changes.
 */
export const NO_CHANNELS_REASON =
  "No social account is connected yet, so nothing can publish. Connect one in Settings.";
