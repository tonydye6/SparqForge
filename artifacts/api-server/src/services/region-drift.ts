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
   * Changed fraction of the pixels that carry SUBJECT, which is the number to
   * judge a retouch by.
   */
  subjectChangePercent: number;
  sampled: number;
  changed: number;
  subjectSampled: number;
  subjectChanged: number;
}

/**
 * Structure threshold that separates subject from empty ground.
 *
 * Applied to a Laplacian of the before image. A studio backdrop or a flat
 * gradient has almost none; a character's edges, folds and trim have plenty.
 */
const CONTENT_EDGE_THRESHOLD = 12;

export async function measureChange(before: Buffer, after: Buffer): Promise<ChangeMeasurement> {
  const meta = await sharp(before).metadata();
  const srcW = meta.width ?? DRIFT_SAMPLE_EDGE;
  const srcH = meta.height ?? DRIFT_SAMPLE_EDGE;
  const scale = Math.min(1, DRIFT_SAMPLE_EDGE / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const toRaw = (buf: Buffer) =>
    sharp(buf).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer();

  /*
   * WHY A CONTENT MASK, and it was learned the expensive way.
   *
   * A live spot removal on 2026-08-07 reported 3.1% of the frame changed and
   * the guard called that "within recompression noise". Measured properly the
   * subject's face had moved 16%, the boots 25% and the keyline 34-50%, while
   * the large empty background was untouched at 0% — and because the background
   * is most of the picture, it averaged the whole thing down to nearly nothing.
   *
   * **An area-based percentage answers "how much of the picture changed" when
   * the question is "did the character survive".** On a character turnaround,
   * which is most of what needs retouching here, the subject is a minority of
   * the pixels and a global figure will always flatter the result. So the
   * verdict is taken over the pixels that carry subject.
   */
  const [a, b, edges] = await Promise.all([
    toRaw(before),
    toRaw(after),
    sharp(before)
      .resize(w, h, { fit: "fill" })
      .greyscale()
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
      .raw()
      .toBuffer(),
  ]);

  let changed = 0;
  let subjectSampled = 0;
  let subjectChanged = 0;
  const sampled = w * h;

  for (let i = 0; i < sampled; i++) {
    const p = i * 3;
    const differs =
      Math.abs(a[p] - b[p]) > CHANNEL_TOLERANCE ||
      Math.abs(a[p + 1] - b[p + 1]) > CHANNEL_TOLERANCE ||
      Math.abs(a[p + 2] - b[p + 2]) > CHANNEL_TOLERANCE;
    if (differs) changed++;

    if (edges[i] > CONTENT_EDGE_THRESHOLD) {
      subjectSampled++;
      if (differs) subjectChanged++;
    }
  }

  return {
    changePercent: computeDriftPercent(changed, sampled),
    /*
     * Falls back to the global figure when the image has no structure at all,
     * rather than reporting a confident 0% on a frame it could not read. A
     * measurement that cannot be made must not look like a good result.
     */
    subjectChangePercent: subjectSampled > 0
      ? computeDriftPercent(subjectChanged, subjectSampled)
      : computeDriftPercent(changed, sampled),
    sampled,
    changed,
    subjectSampled,
    subjectChanged,
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
