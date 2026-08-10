/**
 * The bridge. What the spine decided, turned into what publishing reads.
 *
 * THE GAP THIS CLOSES. Studio v2 wrote `stage_takes` and nothing else. That
 * table is read by exactly three stage routes, the saved-run route, and the
 * file-reference guard: nothing in the publish path has ever seen a stage take.
 * So a post could be walked through all five stages, locked, and approved, and
 * the `creative_variants` row that the scheduler actually sends stayed empty.
 * Everything from the spread to cross-brand fan-out produced work that could
 * not go out.
 *
 * A variant is the unit publishing understands: one row per channel, carrying
 * the picture, the words and the framing. This module decides what those rows
 * should say. It writes nothing; the route does that in one transaction.
 *
 * WHAT IT REFUSES TO GUESS. If the copy stage never wrote a version for a
 * channel, the base caption is used and SAID so, rather than silently shipping
 * a generic caption as though it were written for that placement. If framing
 * was never set, the default focal point is used and said so. A missing picture
 * or missing copy blocks the whole thing, because a variant with neither is not
 * a post.
 *
 * Pure, and runnable under tsx like the other services carrying invariants.
 */

import type { Channel } from "./channels.js";
import { NO_CHANNELS_REASON } from "./channels.js";
import { DEFAULT_FOCAL, type Focal } from "./crop-stage.js";

/** The current `selected` take of stage 03. */
export interface ShipImage {
  imageUrl: string;
  /** The take's slot, kept so a variant can say which take of the spread it is. */
  slotKey?: string;
}

/** The current `copy` take of stage 04. */
export interface ShipCopy {
  hook: string;
  base: string;
  channels: Record<string, { caption?: string; hashtags?: string; authored?: boolean }>;
}

/** The current `crops` take of stage 05. */
export interface ShipCrops {
  focal: Focal;
}

export interface ShipInput {
  channels: Channel[];
  image: ShipImage | null;
  copy: ShipCopy | null;
  crops: ShipCrops | null;
  /** Variants already on this creative, so shipping twice updates rather than duplicates. */
  existingVariants: Array<{ id: string; platform: string }>;
}

export interface PlannedVariant {
  platform: string;
  label: string;
  /**
   * The account this channel will publish through by default. Carried on the
   * plan so the preview can SAY it: with every brand currently posting through
   * the shared Sparq accounts, which handle a post goes out under is exactly
   * the kind of fact that must not be discovered after publishing.
   */
  accountId: string;
  accountName: string | null;
  aspectRatio: string;
  /** The caption as it will publish, hashtags included. */
  caption: string;
  /** The second text layer. Null when the post has no hook. */
  hookText: string | null;
  imageUrl: string;
  focalX: number;
  focalY: number;
  /** Set when a variant for this channel already exists and will be updated. */
  existingId: string | null;
}

export interface ShipPlan {
  variants: PlannedVariant[];
  /** Reasons nothing can ship. Empty means it can. */
  blocked: string[];
  /** True things worth knowing that do not stop the post going out. */
  warnings: string[];
}

/** The published caption is the channel's words plus its hashtags, as one body. */
export function composeCaption(caption: string, hashtags: string): string {
  const body = (caption ?? "").trim();
  const tags = (hashtags ?? "").trim();
  if (!body) return tags;
  if (!tags) return body;
  return `${body}\n\n${tags}`;
}

/**
 * Decide what shipping would write.
 *
 * Deliberately returns a PLAN rather than performing anything, so the same
 * function answers the free preview and the write. That is what lets the
 * Studio show, before anybody commits, exactly which channels get what and
 * which parts are falling back to a default. Doc 24 §8: show the consequence
 * before the act.
 */
export function planShip(input: ShipInput): ShipPlan {
  const blocked: string[] = [];
  const warnings: string[] = [];

  if (input.channels.length === 0) blocked.push(NO_CHANNELS_REASON);
  if (!input.image) {
    blocked.push("No picture has been chosen yet. Open stage 03 and choose one with Use this take.");
  }
  if (!input.copy) {
    blocked.push("No copy has been written yet. Open stage 04 and save it.");
  }

  if (blocked.length > 0) return { variants: [], blocked, warnings };

  const image = input.image!;
  const copy = input.copy!;

  const focal = input.crops?.focal;
  const focalX = typeof focal?.x === "number" ? focal.x : DEFAULT_FOCAL.x;
  const focalY = typeof focal?.y === "number" ? focal.y : DEFAULT_FOCAL.y;
  if (!focal) {
    warnings.push(
      "Framing was never set, so every channel crops around the default point. Open stage 05 to place it.",
    );
  }

  const hook = (copy.hook ?? "").trim();
  if (!hook) {
    warnings.push("This post has no hook, so it ships with the picture as it is and no text layer.");
  }

  const existingByPlatform = new Map(input.existingVariants.map((v) => [v.platform, v.id]));

  const variants: PlannedVariant[] = input.channels.map((channel) => {
    const written = copy.channels?.[channel.platform];
    const channelCaption = (written?.caption ?? "").trim();

    // Falling back is allowed. Falling back QUIETLY is not: a generic caption
    // presented as one written for the placement is the kind of thing nobody
    // notices until it has published.
    if (!channelCaption) {
      warnings.push(
        `${channel.label} has no caption of its own, so it ships with the base caption.`,
      );
    }
    if (!channel.furnitureMapped) {
      warnings.push(
        `${channel.label}'s on-screen furniture is not mapped yet, so its crop was not checked for cover-up.`,
      );
    }

    const defaultAccount = channel.accounts.find((a) => a.id === channel.defaultAccountId);

    return {
      platform: channel.platform,
      label: channel.label,
      accountId: channel.defaultAccountId,
      accountName: defaultAccount?.accountName ?? null,
      aspectRatio: channel.aspectLabel,
      caption: composeCaption(channelCaption || copy.base || "", written?.hashtags ?? ""),
      hookText: hook || null,
      imageUrl: image.imageUrl,
      focalX,
      focalY,
      existingId: existingByPlatform.get(channel.platform) ?? null,
    };
  });

  // An existing variant on a channel the brand can no longer publish to is left
  // alone rather than deleted: it may already be scheduled or published, and
  // its history is the only record of what went out.
  const orphaned = input.existingVariants.filter(
    (v) => !input.channels.some((c) => c.platform === v.platform),
  );
  if (orphaned.length === 1) {
    warnings.push(
      `One older version, on a channel this brand no longer publishes to, was left untouched.`,
    );
  } else if (orphaned.length > 1) {
    warnings.push(
      `${orphaned.length} older versions, on channels this brand no longer publishes to, were left untouched.`,
    );
  }

  return { variants, blocked, warnings };
}

/**
 * Whether shipping is safe right now, given what is already on the calendar.
 *
 * A scheduled entry points at a variant. Rewriting that variant underneath it
 * changes what will publish without anybody deciding to, which is the same
 * class of failure as an approval surviving a content swap. Refusing and naming
 * the entries is the honest move: unscheduling is one click and reversible,
 * publishing the wrong thing is not.
 */
export function shippingBlockedBySchedule(
  entries: Array<{ platform: string; publishStatus: string }>,
): string | null {
  const live = entries.filter((e) => e.publishStatus === "scheduled" || e.publishStatus === "publishing");
  if (live.length === 0) return null;
  const names = [...new Set(live.map((e) => e.platform))].join(", ");
  return `This post is already scheduled on ${names}. Unschedule it in the Pipeline first, `
    + "so nothing changes underneath a post that is waiting to go out.";
}
