/**
 * Phase 9 · which medium a channel can take, and whether they are the same work.
 *
 * Doc 21 §4.5: "A channel can then take either medium from one creative." That
 * sentence is the whole reason `sourceImageVariantId` exists, and until now
 * nothing wrote it and nothing read it — M4 shipped six columns and the
 * api-server mentions none of them. This is the reader.
 *
 * **The distinction only this data can make.** A creative can hold a still and a
 * clip for the same platform without the clip being that still in motion: it
 * might have been converted from a different take, or generated on its own.
 * `videoUrl != null` cannot tell those apart, so a surface built on it would
 * offer "image or video" as though they were two renderings of one idea when
 * sometimes they are two different ideas. `motionFromThisImage` is that answer,
 * and it is the reason the column earns its place rather than joining the other
 * five unread ones.
 *
 * Pure: no DB, no clock. The caller supplies the variants.
 */

export type Medium = "image" | "motion";

export interface VariantLike {
  id: string;
  platform: string;
  /** M4's column. NULL on every row written before it existed. */
  mediumType?: string | null;
  videoUrl?: string | null;
  /** M4's lineage column: the still this motion was animated from. */
  sourceImageVariantId?: string | null;
  /** Newest wins when a platform holds several of one medium. */
  createdAt?: Date | string | null;
}

/**
 * What this variant actually is.
 *
 * The explicit column wins, but it is trusted only when it holds a value this
 * code knows. Everything written before M4 has NULL, so falling back to
 * `videoUrl` is not a convenience — it is the only thing that makes the
 * function correct on the existing library. NULL meaning "image" is the
 * column's own documented contract, not an assumption made here.
 */
export function mediumOf(v: VariantLike): Medium {
  if (v.mediumType === "motion" || v.mediumType === "image") return v.mediumType;
  return v.videoUrl ? "motion" : "image";
}

export interface MediumChoice {
  platform: string;
  imageVariantId: string | null;
  motionVariantId: string | null;
  /**
   * True when the motion on offer was animated from the still on offer.
   *
   * False means the channel is being asked to choose between two different
   * pieces of work, and the surface should say so rather than presenting them
   * as one thing in two formats. Null-ish case: no motion, so nothing to claim.
   */
  motionFromThisImage: boolean;
}

function timeOf(v: VariantLike): number {
  if (!v.createdAt) return 0;
  const d = v.createdAt instanceof Date ? v.createdAt : new Date(v.createdAt);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

/** The newest variant of a medium, or null. Ties break on id so it is stable. */
function newest(variants: readonly VariantLike[], medium: Medium): VariantLike | null {
  const of = variants.filter(v => mediumOf(v) === medium);
  if (of.length === 0) return null;
  return of.reduce((best, v) => {
    const dt = timeOf(v) - timeOf(best);
    if (dt > 0) return v;
    if (dt < 0) return best;
    return v.id > best.id ? v : best;
  });
}

/**
 * What each platform in this creative can ship, and whether the two media agree.
 *
 * One row per platform that has anything at all. Platforms are returned sorted
 * so the surface's order does not depend on insertion order.
 */
export function mediaChoices(variants: readonly VariantLike[]): MediumChoice[] {
  const byPlatform = new Map<string, VariantLike[]>();
  for (const v of variants) {
    const bucket = byPlatform.get(v.platform);
    if (bucket) bucket.push(v);
    else byPlatform.set(v.platform, [v]);
  }

  const out: MediumChoice[] = [];
  for (const [platform, group] of byPlatform) {
    const image = newest(group, "image");
    const motion = newest(group, "motion");
    out.push({
      platform,
      imageVariantId: image?.id ?? null,
      motionVariantId: motion?.id ?? null,
      /*
       * Requires BOTH the link and a still to match it against. A clip whose
       * lineage is unrecorded (everything predating this change) reports false
       * rather than true, because "we do not know" and "yes" must not look the
       * same on a screen whose whole job is to say what you are choosing.
       */
      motionFromThisImage: Boolean(
        image && motion && motion.sourceImageVariantId === image.id,
      ),
    });
  }
  return out.sort((a, b) => a.platform.localeCompare(b.platform));
}
