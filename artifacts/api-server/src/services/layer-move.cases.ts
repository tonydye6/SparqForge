/**
 * A move must land exactly, keep its size, and never alter the artwork.
 *
 * The prose version of this feature failed all three (see layer-move.ts for the
 * three measured renders), so these cases check the properties that compositing
 * is supposed to guarantee ABSOLUTELY, not approximately.
 */
import sharp from "sharp";
import {
  applyLayerMove,
  featherRadius,
  incompleteRemovalNote,
  meanAbsDifference,
  patchDestination,
  pixelRect,
  rectsOverlap,
  removalLooksIncomplete,
  removalPrompt,
  REMOVAL_DIFFERENCE_FLOOR,
} from "./layer-move.js";

export interface CaseResult { name: string; ok: boolean; detail?: string }

/** A frame with a solid block of colour at a known place. */
async function frameWithBlock(
  w: number, h: number,
  block: { left: number; top: number; width: number; height: number },
  colour: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 20, b: 30 } } })
    .composite([{
      input: await sharp({
        create: { width: block.width, height: block.height, channels: 3, background: colour },
      }).png().toBuffer(),
      left: block.left, top: block.top,
    }])
    .png().toBuffer();
}

/** Mean colour of one rectangle, as raw RGB means. */
async function meanColour(buf: Buffer, r: { left: number; top: number; width: number; height: number }) {
  const raw = await sharp(buf).extract(r).removeAlpha().raw().toBuffer();
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < raw.length; i += 3) { sr += raw[i]!; sg += raw[i + 1]!; sb += raw[i + 2]!; }
  const n = raw.length / 3;
  return { r: sr / n, g: sg / n, b: sb / n };
}

export async function runCases(): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    out.push({ name, ok, detail: ok ? undefined : String(detail) });

  // ---- geometry, pure ----
  check("a normalised box becomes whole pixels",
    JSON.stringify(pixelRect({ x: 0.25, y: 0.5, w: 0.25, h: 0.1 }, 400, 200))
      === JSON.stringify({ left: 100, top: 100, width: 100, height: 20 }));

  check("a box running off the right edge is clipped, not wrapped",
    (() => { const r = pixelRect({ x: 0.9, y: 0, w: 0.5, h: 0.5 }, 100, 100);
      return r.left + r.width <= 100; })());

  check("a degenerate box still yields at least one pixel, so sharp cannot throw",
    (() => { const r = pixelRect({ x: 0.5, y: 0.5, w: 0, h: 0 }, 100, 100);
      return r.width >= 1 && r.height >= 1; })());

  /*
   * The size guarantee. The old path was told "keep the same size" and returned
   * the mark at twice its width; here the destination is DERIVED from the
   * patch's pixel size, so it cannot differ.
   */
  const patch = { width: 60, height: 40 };
  const dest = patchDestination({ x: 0.1, y: 0.1, w: 0.15, h: 0.2 }, patch, 400, 200);
  check("the destination keeps the patch's exact pixel size",
    dest.width === patch.width && dest.height === patch.height, dest);
  check("the patch is centred on the requested centre",
    dest.left === Math.round(0.175 * 400 - 30) && dest.top === Math.round(0.2 * 200 - 20), dest);
  check("a destination near the edge is nudged inside rather than cropped",
    (() => { const d = patchDestination({ x: 0.95, y: 0.95, w: 0.1, h: 0.1 }, patch, 400, 200);
      return d.left + d.width <= 400 && d.top + d.height <= 200 && d.width === 60; })());

  check("overlap is detected", rectsOverlap(
    { left: 0, top: 0, width: 10, height: 10 }, { left: 5, top: 5, width: 10, height: 10 }));
  check("and non-overlap is not", !rectsOverlap(
    { left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 20, width: 5, height: 5 }));

  check("the feather is at least 2px even on a tiny patch",
    featherRadius({ width: 8, height: 8 }) >= 2);

  // ---- the removal prompt asks for one thing ----
  const rp = removalPrompt("the brand mark in Crown-U_Mark_Gold.png", "a small area in the upper centre");
  /*
   * Word boundaries matter here: without them this very check reports a false
   * positive, because "Remove" contains "move" and "replace" contains "place".
   */
  check("the removal prompt never mentions a destination",
    !/\bplace\b|\bmove\b|\bnew position\b|\bto the (left|right)\b/i.test(rp), rp);
  check("it forbids a leftover trace by name", /shadow, outline, smudge or faded trace/.test(rp));
  check("it forbids drawing a second copy elsewhere", /do not draw it anywhere else/.test(rp));

  // ---- difference measurement ----
  check("identical buffers differ by zero",
    meanAbsDifference(Buffer.from([1, 2, 3]), Buffer.from([1, 2, 3])) === 0);
  check("a full-scale flip differs by 255",
    meanAbsDifference(Buffer.from([0, 0]), Buffer.from([255, 255])) === 255);
  check("an unvacated rectangle is called incomplete",
    removalLooksIncomplete(REMOVAL_DIFFERENCE_FLOOR - 1));
  check("a repainted one is not", !removalLooksIncomplete(REMOVAL_DIFFERENCE_FLOOR + 40));
  check("the warning names the layer and says what to do",
    incompleteRemovalNote("Crown U Mark").includes("Crown U Mark")
      && /Undo this take/.test(incompleteRemovalNote("Crown U Mark")));

  /*
   * ---- END TO END, PROVEN BY PIXELS ----
   *
   * A 200x100 frame with a red 40x20 block at (20,10). The "removal pass" is
   * the same frame with no block. A real move should leave the destination red
   * and the origin background-coloured.
   */
  const FRAME = { w: 200, h: 100 };
  const BLOCK = { left: 20, top: 10, width: 40, height: 20 };
  const RED = { r: 220, g: 30, b: 30 };
  const before = await frameWithBlock(FRAME.w, FRAME.h, BLOCK, RED);
  const filled = await sharp({
    create: { width: FRAME.w, height: FRAME.h, channels: 3, background: { r: 20, g: 20, b: 30 } },
  }).png().toBuffer();

  const fromNorm = { x: BLOCK.left / FRAME.w, y: BLOCK.top / FRAME.h, w: BLOCK.width / FRAME.w, h: BLOCK.height / FRAME.h };
  // A 17% shift right - the magnitude the prose path could never achieve.
  const toNorm = { ...fromNorm, x: fromNorm.x + 0.17 };

  const moved = await applyLayerMove({ beforeBuffer: before, filledBuffer: filled, from: fromNorm, to: toNorm, layerName: "the block" });

  check("the patch is cut at the layer's exact pixel size",
    moved.from.width === BLOCK.width && moved.from.height === BLOCK.height, moved.from);
  check("and lands at exactly the requested displacement",
    moved.to.left === BLOCK.left + Math.round(0.17 * FRAME.w), { to: moved.to });

  const atDestination = await meanColour(moved.imageBuffer, {
    left: moved.to.left + 8, top: moved.to.top + 5, width: 24, height: 10,
  });
  check("THE LAYER IS ACTUALLY AT THE NEW POSITION",
    atDestination.r > 150 && atDestination.g < 90, atDestination);

  const atOrigin = await meanColour(moved.imageBuffer, {
    left: BLOCK.left + 8, top: BLOCK.top + 5, width: 12, height: 10,
  });
  check("and no longer at the old one",
    atOrigin.r < 90, atOrigin);

  check("a clean removal raises no warning", moved.warning === null, moved.removalDifference);

  /*
   * The failure that matters: if the model does NOT clear the old position,
   * pasting a copy gives two of them, so it must be reported.
   */
  const notRemoved = await applyLayerMove({
    beforeBuffer: before, filledBuffer: before, from: fromNorm, to: toNorm, layerName: "the block",
  });
  check("a removal that did nothing is detected", notRemoved.warning !== null, notRemoved.removalDifference);
  check("and the warning says the picture may show it twice",
    /twice/.test(notRemoved.warning ?? ""), notRemoved.warning);

  // Size preservation is the property the old path broke; assert it directly.
  check("THE PATCH IS NEVER RESIZED",
    moved.to.width === moved.from.width && moved.to.height === moved.from.height);

  return out;
}
