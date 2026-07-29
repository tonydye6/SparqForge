import sharp from "sharp";

import { computeDriftPercent, containsPoint, type Region } from "./region-edit.js";

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
