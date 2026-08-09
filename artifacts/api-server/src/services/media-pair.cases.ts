/**
 * Assertions for the medium resolver.
 *
 * The cases that matter are the ones about the EXISTING library: every variant
 * written before M4 has `mediumType` NULL, so a resolver that trusted the column
 * alone would report a library full of stills, including the clips.
 */
import { mediaChoices, mediumOf, type VariantLike } from "./media-pair.js";

const v = (over: Partial<VariantLike> & { id: string }): VariantLike => ({
  platform: "instagram_feed",
  ...over,
});

export interface Result { name: string; ok: boolean; detail?: unknown }

export function runCases(): Result[] {
  const results: Result[] = [];
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    results.push({ name, ok, detail: ok ? undefined : detail });
  };

  // ---- what a variant is ----
  check("an explicit motion is motion", mediumOf(v({ id: "a", mediumType: "motion" })) === "motion");
  check("an explicit image is image",
    mediumOf(v({ id: "a", mediumType: "image", videoUrl: "/x.mp4" })) === "image");
  /*
   * THE CASE THIS FILE EXISTS FOR. Every row written before M4 has NULL here,
   * and the app has been making videos for months. Trusting the column alone
   * would classify all of them as stills.
   */
  check("a pre-M4 clip is still recognised as motion",
    mediumOf(v({ id: "a", mediumType: null, videoUrl: "/clip.mp4" })) === "motion");
  check("a pre-M4 still is an image", mediumOf(v({ id: "a", mediumType: null })) === "image");
  check("an unknown medium value falls back to the url, not to itself",
    mediumOf(v({ id: "a", mediumType: "hologram", videoUrl: "/clip.mp4" })) === "motion");

  // ---- the pairing ----
  {
    const out = mediaChoices([
      v({ id: "img1" }),
      v({ id: "vid1", mediumType: "motion", videoUrl: "/1.mp4", sourceImageVariantId: "img1" }),
    ]);
    check("one platform, both media", out.length === 1, out);
    check("the still is offered", out[0]?.imageVariantId === "img1", out[0]);
    check("the motion is offered", out[0]?.motionVariantId === "vid1", out[0]);
    check("and they are the same work", out[0]?.motionFromThisImage === true, out[0]);
  }
  {
    /*
     * The clip exists but came from a DIFFERENT take. The channel is choosing
     * between two pieces of work, and saying otherwise would be the lie this
     * flag exists to prevent.
     */
    const out = mediaChoices([
      v({ id: "img2", createdAt: "2026-08-02" }),
      v({ id: "vid1", mediumType: "motion", videoUrl: "/1.mp4", sourceImageVariantId: "img1" }),
    ]);
    check("motion from another take is not claimed as this one's",
      out[0]?.motionFromThisImage === false, out[0]);
    check("but it is still offered", out[0]?.motionVariantId === "vid1", out[0]);
  }
  {
    // A pre-M4 clip has no lineage at all. Unknown must not read as yes.
    const out = mediaChoices([
      v({ id: "img1" }),
      v({ id: "vid1", videoUrl: "/1.mp4" }),
    ]);
    check("unrecorded lineage reads as not-known, never as yes",
      out[0]?.motionFromThisImage === false, out[0]);
  }
  {
    const out = mediaChoices([v({ id: "img1" })]);
    check("a still on its own offers no motion", out[0]?.motionVariantId === null, out[0]);
    check("and claims no relationship", out[0]?.motionFromThisImage === false, out[0]);
  }
  {
    const out = mediaChoices([
      v({ id: "vid1", mediumType: "motion", videoUrl: "/1.mp4", sourceImageVariantId: "gone" }),
    ]);
    check("motion whose still is not here offers no image", out[0]?.imageVariantId === null, out[0]);
    check("and cannot claim a pairing", out[0]?.motionFromThisImage === false, out[0]);
  }

  // ---- newest wins, deterministically ----
  {
    const out = mediaChoices([
      v({ id: "old", createdAt: "2026-08-01" }),
      v({ id: "new", createdAt: "2026-08-05" }),
    ]);
    check("the newest still is the one offered", out[0]?.imageVariantId === "new", out[0]);
  }
  {
    // Same timestamp: the answer must not depend on array order.
    const a = mediaChoices([v({ id: "aaa", createdAt: "2026-08-01" }), v({ id: "bbb", createdAt: "2026-08-01" })]);
    const b = mediaChoices([v({ id: "bbb", createdAt: "2026-08-01" }), v({ id: "aaa", createdAt: "2026-08-01" })]);
    check("ties break the same way whichever order they arrive in",
      a[0]?.imageVariantId === b[0]?.imageVariantId, [a[0], b[0]]);
  }

  // ---- several platforms ----
  {
    const out = mediaChoices([
      v({ id: "ig", platform: "instagram_feed" }),
      v({ id: "yt", platform: "youtube" }),
      v({ id: "ytv", platform: "youtube", mediumType: "motion", videoUrl: "/y.mp4", sourceImageVariantId: "yt" }),
    ]);
    check("one row per platform", out.length === 2, out);
    check("platforms come back in a stable order",
      out.map(c => c.platform).join() === "instagram_feed,youtube", out);
    check("a platform's pairing does not leak across platforms",
      out.find(c => c.platform === "instagram_feed")?.motionVariantId === null, out);
    check("the other platform keeps its own pairing",
      out.find(c => c.platform === "youtube")?.motionFromThisImage === true, out);
  }

  check("nothing in, nothing out", mediaChoices([]).length === 0);

  return results;
}
