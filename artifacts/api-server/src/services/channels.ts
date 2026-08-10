/**
 * The one answer to "which channels is this post for".
 *
 * THE BUG THIS EXISTS TO KILL. Three surfaces in the Studio each decided this
 * for themselves and gave three different answers on the same post:
 *
 *   stage 01  read the brand's connected accounts        (Instagram, X)
 *   stage 04  hardcoded instagram_feed, twitter, linkedin, tiktok
 *   stage 05  hardcoded instagram_feed, instagram_story, tiktok, twitter
 *
 * So a post got LinkedIn copy that could never publish, and an Instagram Story
 * crop that nothing had written copy for. Whichever set is right, three cannot
 * be, and the brief's answer is the only one grounded in something real.
 *
 * THE RULE: a channel exists for this post if the brand has a connected account
 * that can publish it. Nothing else qualifies a channel. That is also what
 * makes the whole flow honest end to end, because it is the same fact the
 * publish scheduler enforces at send time and the same one the failure surface
 * reports as `no_account`.
 *
 * Pure, and runnable under tsx like the other services carrying invariants.
 */

import { ACCOUNT_PLATFORM_MAP } from "../lib/platform-accounts.js";
import { PLATFORM_COPY_RULES } from "./copy-stage.js";
import { CROP_TARGETS } from "./crop-stage.js";

export interface Channel {
  /** The calendar-entry platform. What a variant and an entry are keyed by. */
  platform: string;
  label: string;
  /** The social account that publishes it. Instagram serves feed AND story. */
  accountPlatform: string;
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
 * Every channel this brand can actually publish to.
 *
 * `connectedAccountPlatforms` are social-account platforms ("instagram"), not
 * entry platforms ("instagram_feed"). One account can serve more than one
 * placement, which is why this is an expansion rather than a filter, and why it
 * reads `ACCOUNT_PLATFORM_MAP` backwards instead of keeping a second copy of
 * that relationship.
 */
export function resolveChannels(connectedAccountPlatforms: readonly string[]): Channel[] {
  const connected = new Set(connectedAccountPlatforms.map((p) => p.trim()).filter(Boolean));
  const cropByPlatform = new Map(CROP_TARGETS.map((t) => [t.platform, t]));

  return CHANNEL_ORDER.filter((platform) => connected.has(ACCOUNT_PLATFORM_MAP[platform] ?? platform))
    .map((platform) => {
      const crop = cropByPlatform.get(platform);
      return {
        platform,
        label: CHANNEL_LABELS[platform] ?? platform,
        accountPlatform: ACCOUNT_PLATFORM_MAP[platform] ?? platform,
        aspectLabel: crop?.aspectLabel ?? FALLBACK_ASPECT[platform] ?? "1:1",
        furnitureMapped: crop !== undefined,
        hasSafeAreas: (crop?.safeAreas.length ?? 0) > 0,
        hasCopyRules: platform in PLATFORM_COPY_RULES,
      };
    });
}

/**
 * What to say when a brand has no connected account at all.
 *
 * Its own function because three surfaces need the same sentence, and because
 * "no channels" is the single most consequential state in the Studio: nothing
 * made can go anywhere until it changes.
 */
export const NO_CHANNELS_REASON =
  "No channel is connected for this brand yet, so nothing can publish. Connect one in Settings.";
