import sharp from "sharp";

import { computeDriftPercent, containsPoint, type Region } from "./region-edit.js";
import {
  estimateBackground,
  subjectMask,
  erodeMask,
  intersectMasks,
  backgroundChanged,
} from "./asset-retouch.js";

/**
 * Measuring how far a region edit strayed outside its mask.
 *
 * Separate from region-edit.ts so that file stays pure: the geometry and the
 * arithmetic are unit-tested, and this holds the one part that needs real pixels.
 *
 * The comparison runs at a reduced resolution on purpose. Drift is a proportion,
 * not a pixel address, so a 256px sample answers the question at a fraction of
 * the cost, and it also blurs away the single-pixel recompression noise that
 * would otherwise dominate a full-resolution diff.
 */

/** Longest edge of the comparison sample. */
export const DRIFT_SAMPLE_EDGE = 256;

/**
 * Per-channel difference below which two pixels count as unchanged.
 *
 * Lossy recompression alone moves flat areas by a few values, so comparing for
 * exact equality would report every successful edit as total drift.
 */
export const CHANNEL_TOLERANCE = 10;

export interface DriftMeasurement {
  driftPercent: number;
  /** Pixels sampled outside the mask. Zero means the mask covered the frame. */
  sampledOutside: number;
  changedOutside: number;
}

/**
 * Compare before and after, counting only what changed OUTSIDE the mask.
 *
 * Both images are forced to the same sample geometry before comparison. Without
 * that a returned image at a different resolution would misalign every pixel and
 * report near-total drift on a perfectly good edit.
 */
export async function measureDrift(
  before: Buffer,
  after: Buffer,
  region: Region,
): Promise<DriftMeasurement> {
  const meta = await sharp(before).metadata();
  const srcW = meta.width ?? DRIFT_SAMPLE_EDGE;
  const srcH = meta.height ?? DRIFT_SAMPLE_EDGE;
  const scale = Math.min(1, DRIFT_SAMPLE_EDGE / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const toRaw = (buf: Buffer) =>
    sharp(buf)
      // fit: "fill" rather than "cover": cover would crop, and a crop shifts
      // every pixel so the diff would measure the crop rather than the edit.
      .resize(w, h, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();

  const [a, b] = await Promise.all([toRaw(before), toRaw(after)]);

  let sampledOutside = 0;
  let changedOutside = 0;

  for (let y = 0; y < h; y++) {
    // Sample pixel centres, so a mask edge does not systematically fall on the
    // boundary of every pixel it touches.
    const ny = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w;
      if (containsPoint(region, nx, ny)) continue;

      sampledOutside++;
      const i = (y * w + x) * 3;
      if (
        Math.abs(a[i] - b[i]) > CHANNEL_TOLERANCE ||
        Math.abs(a[i + 1] - b[i + 1]) > CHANNEL_TOLERANCE ||
        Math.abs(a[i + 2] - b[i + 2]) > CHANNEL_TOLERANCE
      ) {
        changedOutside++;
      }
    }
  }

  return {
    driftPercent: computeDriftPercent(changedOutside, sampledOutside),
    sampledOutside,
    changedOutside,
  };
}

/**
 * How much of the WHOLE frame changed, with no mask involved.
 *
 * A region edit asks "did it stray outside what I selected". An asset retouch
 * asks a different question — "did it repaint the picture" — because there is
 * no selection: the scope is prose, and the only honest measure of restraint is
 * the total changed fraction. A swoosh coming off a thigh is a fraction of a
 * percent; a character who came back as a different person is tens of percent.
 *
 * Shares `measureDrift`'s resize and tolerance discipline deliberately. Both are
 * load-bearing rather than incidental: without the forced common geometry a
 * returned image at another resolution misaligns every pixel and reports total
 * change on a perfect edit, and without the tolerance lossy recompression alone
 * does the same.
 */
export interface ChangeMeasurement {
  /** Changed fraction of the whole frame. Diluted by empty space — see below. */
  changePercent: number;
  /**
   * Changed fraction of the subject's INTERIOR, which is the number to judge a
   * retouch by.
   */
  subjectChangePercent: number;
  sampled: number;
  changed: number;
  subjectSampled: number;
  subjectChanged: number;
  /**
   * True when the ground itself was replaced, e.g. a cutout that came back on
   * white instead of black. Reported rather than scored: it says nothing about
   * whether the character survived, and letting it into the score is precisely
   * what made the previous metric call good retouches "repainted".
   */
  backgroundReplaced: boolean;
  /** True when both frames had a readable flat ground, so the mask is real. */
  hadBackground: boolean;
}

/** How far inward the silhouette is discarded, in sample pixels. */
const SILHOUETTE_EROSION = 2;

export async function measureChange(before: Buffer, after: Buffer): Promise<ChangeMeasurement> {
  const meta = await sharp(before).metadata();
  const srcW = meta.width ?? DRIFT_SAMPLE_EDGE;
  const srcH = meta.height ?? DRIFT_SAMPLE_EDGE;
  const scale = Math.min(1, DRIFT_SAMPLE_EDGE / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const toRaw = (buf: Buffer) =>
    sharp(buf)
      // Flattened onto a mid grey rather than left with alpha, so a transparent
      // cutout has a definite colour to compare instead of undefined RGB under
      // its transparent pixels.
      .flatten({ background: { r: 128, g: 128, b: 128 } })
      .resize(w, h, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();

  const [a, b] = await Promise.all([toRaw(before), toRaw(after)]);

  /*
   * Find the ground in each frame, take the subject, throw the silhouette away.
   *
   * See the long note in asset-retouch.ts. The short version: an edge-weighted
   * mask puts all its weight on the silhouette, which is exactly where a
   * background change lands, so it scored good retouches as total repaints.
   * Here the background is identified and excluded, and the subject is eroded
   * inward so the boundary band contributes nothing either way.
   */
  const bgA = estimateBackground(a, w, h);
  const bgB = estimateBackground(b, w, h);
  const hadBackground = bgA.uniform && bgB.uniform;

  const maskA = subjectMask(a, w, h, bgA.uniform ? bgA.colour : null);
  const maskB = subjectMask(b, w, h, bgB.uniform ? bgB.colour : null);
  const core = erodeMask(intersectMasks(maskA, maskB), w, h, SILHOUETTE_EROSION);

  let changed = 0;
  let subjectSampled = 0;
  let subjectChanged = 0;
  const sampled = w * h;

  for (let i = 0; i < sampled; i++) {
    const p = i * 3;
    const differs =
      Math.abs(a[p]! - b[p]!) > CHANNEL_TOLERANCE ||
      Math.abs(a[p + 1]! - b[p + 1]!) > CHANNEL_TOLERANCE ||
      Math.abs(a[p + 2]! - b[p + 2]!) > CHANNEL_TOLERANCE;
    if (differs) changed++;
    if (core[i]) {
      subjectSampled++;
      if (differs) subjectChanged++;
    }
  }

  return {
    changePercent: computeDriftPercent(changed, sampled),
    /*
     * Falls back to the global figure when erosion left nothing to measure —
     * a very small subject, or two frames that share no common subject at all.
     * A measurement that could not be made must never look like a good result.
     */
    subjectChangePercent: subjectSampled > 0
      ? computeDriftPercent(subjectChanged, subjectSampled)
      : computeDriftPercent(changed, sampled),
    sampled,
    changed,
    subjectSampled,
    subjectChanged,
    backgroundReplaced: hadBackground && backgroundChanged(bgA.colour, bgB.colour),
    hadBackground,
  };
}

/**
 * How the region is described to a model that has no mask input.
 *
 * The Interactions API does semantic masking rather than accepting a bitmap, so
 * the geometry has to become words. Coordinates are turned into plain spatial
 * language because "the upper-left quadrant" steers a model and "x: 0.12, y:
 * 0.08, w: 0.4" does not.
 */
export function describeRegion(region: Region): string {
  const centre =
    region.shape === "box"
      ? { x: region.x + region.w / 2, y: region.y + region.h / 2 }
      : region.shape === "point"
        ? { x: region.x, y: region.y }
        : region.points.reduce(
            (acc, p, _i, arr) => ({ x: acc.x + p.x / arr.length, y: acc.y + p.y / arr.length }),
            { x: 0, y: 0 },
          );

  const vert = centre.y < 0.34 ? "upper" : centre.y > 0.66 ? "lower" : "middle";
  const horz = centre.x < 0.34 ? "left" : centre.x > 0.66 ? "right" : "centre";
  const where = vert === "middle" && horz === "centre" ? "centre of the frame" : `${vert} ${horz}`;

  if (region.shape === "box") {
    const size = region.w * region.h;
    const extent = size > 0.5 ? "most of the frame" : size > 0.15 ? "a large area" : "a small area";
    return `${extent} in the ${where}`;
  }
  if (region.shape === "point") {
    return `a small circular area in the ${where}`;
  }
  return `an irregular area in the ${where}`;
}
