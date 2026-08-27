import sharp from "sharp";

/**
 * A LAYER MOVE IS COMPOSITING, NOT RE-IMAGINING.
 *
 * **Why this exists.** A move used to be one generative pass over the union of
 * the old and new places, asked for in prose. Measured 2026-08-27 on one mark,
 * three renders at $0.134 each:
 *
 *   16% displacement, self-contradictory sentence   -> did not move
 *   ~35% displacement, cross-cell, coherent          -> moved, and grew ~2x
 *   17% displacement, explicit "17% to the left"     -> did not move
 *
 * So asking harder was not the answer. Precision of language is not the lever;
 * a small element shifted a modest distance simply does not survive being
 * redrawn. And the one time it did move, it came back at twice its width -
 * because "keep the same size" has no referent once a thing is drawn afresh.
 *
 * **The fix is to stop asking for the part we can do ourselves.** Three steps:
 *
 *   1. CUT the layer's pixels out of the source image. Deterministic, free.
 *   2. Ask the model for ONE thing only: remove what was there and reconstruct
 *      the background behind it. Removal is the operation image models are
 *      reliably good at, and it is the only part that needs invention.
 *   3. PASTE the cut pixels at the new position. Deterministic, free.
 *
 * Position becomes exact because we place it. Scale becomes exact because they
 * are the same pixels. And - this is the part that matters most here - **the
 * layer's own artwork is byte-identical to what it was**, so a composited move
 * cannot recolour, restyle or distort a brand mark. Tony's ruling of 2026-08-23
 * is enforced by construction rather than by asking the model nicely; see
 * `layerEditRefusal` in layer-detection.ts for the other half of that rule.
 *
 * Cost is unchanged: still one generative pass.
 *
 * **What can still go wrong, and is reported rather than hidden.** If the
 * removal pass leaves the element where it was, pasting a copy at the new
 * position yields TWO of them. That is worse than not moving, so the removal is
 * verified by comparing the vacated rectangle against the pixels we cut - see
 * `removalLooksIncomplete`.
 */

/** A normalised box: fractions of the frame, never pixels. */
export interface NormBox { x: number; y: number; w: number; h: number }

/** An integer pixel rectangle, guaranteed to sit inside the frame. */
export interface PixelRect { left: number; top: number; width: number; height: number }

/**
 * A normalised box as whole pixels, clamped into the frame.
 *
 * Rounded rather than truncated so a 1px sliver does not vanish, and floored at
 * 1x1 because sharp throws on a zero-sized extract and a degenerate layer
 * should not take the request down with it.
 */
export function pixelRect(box: NormBox, frameW: number, frameH: number): PixelRect {
  const left = Math.min(Math.max(Math.round(box.x * frameW), 0), Math.max(frameW - 1, 0));
  const top = Math.min(Math.max(Math.round(box.y * frameH), 0), Math.max(frameH - 1, 0));
  const width = Math.max(1, Math.min(Math.round(box.w * frameW), frameW - left));
  const height = Math.max(1, Math.min(Math.round(box.h * frameH), frameH - top));
  return { left, top, width, height };
}

/**
 * Where the cut patch goes, in pixels.
 *
 * The patch keeps the SIZE it was cut at - that is the whole point - so the
 * destination is derived from the requested centre and then clamped so the
 * patch stays wholly inside the frame. Clamping shifts rather than crops:
 * a half-pasted mark is worse than one nudged a few pixels short.
 */
export function patchDestination(
  to: NormBox,
  patch: { width: number; height: number },
  frameW: number,
  frameH: number,
): PixelRect {
  const centreX = (to.x + to.w / 2) * frameW;
  const centreY = (to.y + to.h / 2) * frameH;
  const left = Math.round(centreX - patch.width / 2);
  const top = Math.round(centreY - patch.height / 2);
  return {
    left: Math.min(Math.max(left, 0), Math.max(frameW - patch.width, 0)),
    top: Math.min(Math.max(top, 0), Math.max(frameH - patch.height, 0)),
    width: patch.width,
    height: patch.height,
  };
}

/** True when the two rectangles share any pixel. */
export function rectsOverlap(a: PixelRect, b: PixelRect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width
    && a.top < b.top + b.height && b.top < a.top + a.height;
}

/**
 * How soft the pasted rectangle's own edge is, in pixels.
 *
 * NOTE THIS FEATHERS THE RECTANGLE, NOT THE ARTWORK. The cut includes whatever
 * background surrounded the element, so the seam is background-against-
 * background and a couple of soft pixels hide it. The element's own silhouette
 * is interior to the patch and is never touched, which is why this is safe for
 * a logo: a mark's edges stay exactly as crisp as they were.
 */
export function featherRadius(patch: { width: number; height: number }): number {
  return Math.max(2, Math.round(Math.min(patch.width, patch.height) * 0.02));
}

/**
 * The prompt for step 2, which asks for removal and nothing else.
 *
 * Deliberately says nothing about where the element is going. The model is not
 * being asked to move anything - it is being asked to make the element not be
 * there any more, which is a single, well-posed job. Every word about the
 * destination would be an invitation to draw a second copy.
 */
export function removalPrompt(layerName: string, fromWhere: string): string {
  return `Remove the ${layerName} from ${fromWhere} completely, and reconstruct whatever belongs ` +
    `behind it - the background, surface or scenery that it was covering - so the result looks as ` +
    `though it was never there. Do not replace it with anything, do not leave a shadow, outline, ` +
    `smudge or faded trace of it, and do not draw it anywhere else in the picture. ` +
    `Everything else in the image stays exactly as it is.`;
}

/**
 * Mean absolute difference per channel between two same-sized RGB buffers, 0..255.
 *
 * Cheap, no dependencies, and enough to answer the only question being asked:
 * do these two rectangles still look like the same thing?
 */
export function meanAbsDifference(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.abs(a[i]! - b[i]!);
  return total / n;
}

/**
 * Below this, the vacated rectangle still looks like the thing that was in it.
 *
 * Removal repaints those pixels, so a genuine removal moves them a long way -
 * a mark on a plain ground goes from saturated colour to flat background. 6/255
 * is comfortably above JPEG recompression noise and far below any real repaint.
 */
export const REMOVAL_DIFFERENCE_FLOOR = 6;

/** True when the removal pass appears to have left the element in place. */
export function removalLooksIncomplete(difference: number): boolean {
  return difference < REMOVAL_DIFFERENCE_FLOOR;
}

/** What to tell the operator when the old position was not vacated. */
export function incompleteRemovalNote(layerName: string): string {
  return `${layerName} was placed in its new position, but the model did not clear the old one, ` +
    `so the picture may show it twice. Undo this take if that is what you see.`;
}

export interface MoveResult {
  /** The finished image: background reconstructed, layer pasted at `to`. */
  imageBuffer: Buffer;
  /** Where the patch was cut from and where it landed, in pixels. */
  from: PixelRect;
  to: PixelRect;
  /** How far the vacated rectangle moved, 0..255. Low means a ghost remains. */
  removalDifference: number;
  /** Set when the old position still looks occupied. */
  warning: string | null;
}

/**
 * Cut, paste, and report. `filledBuffer` is the model's removal pass.
 *
 * Kept separate from the model call so the whole geometry and compositing path
 * is testable with two synthetic images and no vendor.
 */
export async function applyLayerMove(params: {
  beforeBuffer: Buffer;
  filledBuffer: Buffer;
  from: NormBox;
  to: NormBox;
  layerName: string;
}): Promise<MoveResult> {
  const { beforeBuffer, filledBuffer, from, to, layerName } = params;

  const meta = await sharp(beforeBuffer).metadata();
  const frameW = meta.width ?? 0;
  const frameH = meta.height ?? 0;
  if (frameW < 2 || frameH < 2) throw new Error("The image has no usable dimensions.");

  const fromRect = pixelRect(from, frameW, frameH);

  // The patch is cut from the ORIGINAL, never from the model's output, so the
  // artwork that lands is the artwork that was there.
  const patch = await sharp(beforeBuffer).extract(fromRect).png().toBuffer();
  const toRect = patchDestination(to, fromRect, frameW, frameH);

  // The removal pass may come back at a different resolution; everything below
  // is measured against the original frame, so normalise first.
  const filled = await sharp(filledBuffer).resize(frameW, frameH, { fit: "fill" }).png().toBuffer();

  // Did the old place actually get vacated? Compared as raw RGB so alpha and
  // encoding cannot flatter the answer.
  const rawOriginal = await sharp(beforeBuffer).extract(fromRect).removeAlpha().raw().toBuffer();
  const rawVacated = await sharp(filled).extract(fromRect).removeAlpha().raw().toBuffer();
  const removalDifference = meanAbsDifference(rawOriginal, rawVacated);

  /*
   * Soft-edged alpha for the patch: a white rectangle inset by the feather
   * radius on a black ground, blurred. Opaque in the middle, fading to nothing
   * at the patch's border. sharp's `create` will not make a 1-channel image, so
   * this is built as greyscale RGB and one channel is taken at the end.
   */
  const radius = featherRadius(fromRect);
  const innerW = Math.max(1, fromRect.width - radius * 2);
  const innerH = Math.max(1, fromRect.height - radius * 2);
  const alpha = await sharp({
    create: {
      width: fromRect.width, height: fromRect.height, channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([{
      input: await sharp({
        create: { width: innerW, height: innerH, channels: 3, background: { r: 255, g: 255, b: 255 } },
      }).png().toBuffer(),
      left: radius, top: radius,
    }])
    .blur(radius)
    .extractChannel(0)
    .raw()
    .toBuffer();

  const feathered = await sharp(await sharp(patch).removeAlpha().png().toBuffer())
    .joinChannel(alpha, { raw: { width: fromRect.width, height: fromRect.height, channels: 1 } })
    .png()
    .toBuffer();

  const imageBuffer = await sharp(filled)
    .composite([{ input: feathered, left: toRect.left, top: toRect.top }])
    .png()
    .toBuffer();

  return {
    imageBuffer,
    from: fromRect,
    to: toRect,
    removalDifference,
    warning: removalLooksIncomplete(removalDifference) ? incompleteRemovalNote(layerName) : null,
  };
}
