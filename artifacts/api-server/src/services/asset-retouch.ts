/**
 * Taking a third-party trademark off a source asset, without losing the asset.
 *
 * The scan found roughly fifty Crown U assets carrying marks nobody licensed —
 * mostly a Nike swoosh, plus a Jumpman, Adidas stripes, an NBA logoman and a
 * few university marks. They are there because the generator invented them:
 * these are AI-rendered characters in invented SPARQ kit, not photographs of
 * real teamwear. **So there is nothing to license, and prompting cannot help,
 * because the identity lock exists to make the renderer copy the reference
 * exactly and it wins that argument every time.** The mark has to come off the
 * pixel.
 *
 * Two things make that cheap. The marks sit almost entirely on small, isolated,
 * high-contrast areas — a shoe, a thigh, a hip, a shoulder — which is the best
 * case for a spot removal. And the scan already recorded WHERE each one is, in
 * words, which is exactly the input the edit needs: the Interactions API does
 * semantic masking rather than taking a bitmap, so `where` becomes the scope
 * clause directly. No geometry, no drawn mask.
 *
 * ⚠️ **A retouch is the one edit that must NOT carry the brand contract.**
 * Every other edit in this system wraps the instruction in
 * `buildSessionStyleContract`, because every other edit is trying to make the
 * image more like the brand. This one is trying to change as little as possible.
 * Handing the model a block of brand visual language while asking it to touch
 * one shoe is an invitation to restyle the whole frame, and the drift guard
 * would then correctly reject a result we paid for.
 *
 * Pure: no DB, no clock, no model call, no pixels. The script does the I/O.
 */

import type { TrademarkFinding } from "./trademark-scan.js";

/**
 * How much of the frame a spot removal may change before it stops being one.
 *
 * Measured over the SUBJECT, not the frame, and the difference is the whole
 * point. There is no mask here — the scope is prose — so the question is not
 * "did it stray outside my selection" but "did the character survive". A live
 * spot removal reported 3.1% of the frame changed while the face had moved 16%
 * and the boots 25%, because the untouched background is most of the picture
 * and averaged it away. `measureChange` returns `subjectChangePercent` for
 * exactly this, and that is the number to compare against this ceiling.
 *
 * 18% is calibrated against that run, which was a good result: two marks gone,
 * identity plainly held, and a subject-change figure in the low teens once the
 * background stopped flattering it. A genuine repaint moves far more.
 */
export const CHANGE_CEILING = 18;

/** Below this, the model almost certainly did nothing at all. */
export const CHANGE_FLOOR = 0.05;

export type RetouchVerdict = "unchanged" | "clean" | "notable" | "repainted";

export function retouchVerdict(changePercent: number): RetouchVerdict {
  if (changePercent < CHANGE_FLOOR) return "unchanged";
  if (changePercent <= CHANGE_CEILING / 2) return "clean";
  if (changePercent <= CHANGE_CEILING) return "notable";
  return "repainted";
}

/**
 * What a person needs to read before keeping or discarding the result.
 *
 * Never says "done". The whole point of the drift guard on region editing was
 * that it applied the instruction and then told the truth about the collateral,
 * rather than hiding it or refusing, and this follows that.
 */
export function retouchMessage(changePercent: number): string {
  const pct = changePercent.toFixed(1);
  switch (retouchVerdict(changePercent)) {
    case "unchanged":
      return `NOTHING CHANGED · ${pct}% of the frame differs. The mark is almost certainly still there. Do not keep this.`;
    case "clean":
      return `CLEAN · ${pct}% of the frame changed, which is the size of a spot removal. Check the mark is gone.`;
    case "notable":
      return `NOTABLE · ${pct}% of the frame changed, more than a spot removal should need. Compare the face and the pose against the original before keeping it.`;
    case "repainted":
      return `REPAINTED · ${pct}% of the frame changed. This is a new picture, not a retouch. Discard it; the character's identity will not have survived.`;
  }
}

/** True when the result is safe to apply without a human looking first. */
export function isSafeToApply(changePercent: number): boolean {
  return retouchVerdict(changePercent) === "clean";
}

export interface RetouchPlan {
  instruction: string;
  /** The marks this instruction sets out to remove. */
  removing: TrademarkFinding[];
  /** Findings deliberately left alone, and why. */
  skipped: Array<{ mark: string; reason: string }>;
}

/**
 * Findings whose location the scan could not name.
 *
 * `trademark-scan` writes "unstated" when the model would not say where a mark
 * was. Without a location there is nothing to scope the edit to, and an
 * unscoped "remove the Nike swoosh" invites the model to repaint the character
 * looking for it. Better to report the asset as needing a human than to spend
 * $0.06 producing a different person.
 */
const NO_LOCATION = "unstated";

export interface RetouchOptions {
  /**
   * Mark kinds to leave in place, normally the ones the brand is licensed for.
   * They were reported by the scan as a separate question; a retouch pass must
   * not quietly answer it by deleting them.
   */
  keepKinds?: readonly TrademarkFinding["kind"][];
}

/**
 * Turn a scan's findings into one spot-removal instruction.
 *
 * ONE instruction covering every mark, not one call per mark. Each pass through
 * an image model is another chance to move something that should not move, so
 * two marks on one asset is one edit, not two, and the drift is measured once.
 */
export function buildRetouchPlan(
  findings: readonly TrademarkFinding[],
  opts: RetouchOptions = {},
): RetouchPlan | null {
  const keep = new Set(opts.keepKinds ?? []);
  const removing: TrademarkFinding[] = [];
  const skipped: Array<{ mark: string; reason: string }> = [];

  for (const f of findings) {
    if (keep.has(f.kind)) {
      skipped.push({ mark: f.mark, reason: `${f.kind} marks are licensed for this brand, so this one is left alone` });
      continue;
    }
    /*
     * Trimmed BEFORE the comparison, and empty counts as no location.
     * `parseTrademarkFindings` already normalises a blank `where` to "unstated",
     * but this must not lean on that: findings also arrive from a saved `--json`
     * scan, and a whitespace-only location would otherwise reach the model as
     * "remove the Nike swoosh from the   ".
     */
    const where = (f.where ?? "").trim();
    if (!where || where.toLowerCase() === NO_LOCATION) {
      skipped.push({ mark: f.mark, reason: "the scan could not say where it is, and an unscoped removal would repaint the subject" });
      continue;
    }
    removing.push({ ...f, where });
  }

  if (removing.length === 0) return null;

  /*
   * The scope clause LEADS, and the preservation clause closes.
   *
   * Position has twice been worth more than wording in this project: the
   * identity lock had to lead the prompt before it held a character, and
   * `imagenPrefix` had to lead the brand contract before its rules survived.
   * The same reasoning applies to an instruction whose entire job is restraint.
   */
  const lines = removing.map(f =>
    `- Remove the ${f.mark} from the ${f.where}. Replace it with the plain surrounding surface, matching that surface's exact colour, shading, texture and lighting so the area reads as unmarked. Remove EVERY occurrence of it in this image, including on any other view, angle or repeat of the same subject.`,
  );

  const instruction = [
    "Change ONLY the small areas listed below. Every other pixel of this image must stay exactly as it is.",
    "",
    ...lines,
    "",
    /*
     * Never describe the subject. The identity-loss bug was caused by prose
     * re-describing a character whose photograph was attached to the same
     * request, and a retouch is that same shape: the picture is right there and
     * words about it can only make it worse.
     */
    "Do not redraw, restyle, re-pose or re-light anything. Do not change the face, hair, build, pose, expression, uniform colours, materials, background, framing, crop or aspect ratio. Do not add anything. This is a spot removal on an otherwise finished image, and the result should be indistinguishable from the original everywhere except where a mark was.",
  ].join("\n");

  return { instruction, removing, skipped };
}

/* ------------------------------------------------------------------------- *
 * Measuring restraint on a cutout, and the mistake this replaces.
 *
 * The first measurement was a flat percentage of the frame, and the untouched
 * background averaged real damage away. The fix weighted it toward pixels with
 * structure, using a Laplacian edge mask — and that fix was wrong in a way that
 * only showed up on the assets it mattered most for.
 *
 * **On a character cut out against a flat ground, the edges ARE the
 * silhouette.** So a mask built from edges is concentrated exactly where the
 * background meets the subject, which is exactly where a background change
 * shows up. A metric built to ignore the background turned out to be maximally
 * sensitive to it: a black-to-white ground swap scored 91-95% "repainted" on
 * retouches whose characters were plainly untouched and whose marks were
 * plainly gone.
 *
 * So: find the background, take the subject, throw the silhouette away, and
 * measure what is left. And when the background itself changed, SAY SO
 * separately instead of letting it into the score.
 * ------------------------------------------------------------------------- */

export interface Rgb { r: number; g: number; b: number }

/** How far a pixel may sit from the background colour and still be background. */
export const BACKGROUND_TOLERANCE = 26;

/**
 * The background colour, read off the frame's border, and whether there is one.
 *
 * A studio cutout has a uniform border; a photograph or a composed scene does
 * not. When the border is not uniform there is no background to exclude, and
 * saying so is better than inventing one and masking off part of the picture.
 */
export function estimateBackground(
  px: Uint8Array | Buffer,
  w: number,
  h: number,
): { colour: Rgb; uniform: boolean } {
  const samples: Rgb[] = [];
  const at = (x: number, y: number): Rgb => {
    const i = (y * w + x) * 3;
    return { r: px[i]!, g: px[i + 1]!, b: px[i + 2]! };
  };
  const step = Math.max(1, Math.floor(Math.min(w, h) / 32));
  for (let x = 0; x < w; x += step) { samples.push(at(x, 0)); samples.push(at(x, h - 1)); }
  for (let y = 0; y < h; y += step) { samples.push(at(0, y)); samples.push(at(w - 1, y)); }

  const mean = samples.reduce(
    (a, c) => ({ r: a.r + c.r / samples.length, g: a.g + c.g / samples.length, b: a.b + c.b / samples.length }),
    { r: 0, g: 0, b: 0 },
  );
  const colour = { r: Math.round(mean.r), g: Math.round(mean.g), b: Math.round(mean.b) };
  // Uniform when almost every border sample sits near that mean. A few stray
  // samples are allowed: a subject often touches one edge of the frame.
  const near = samples.filter(s =>
    Math.abs(s.r - colour.r) <= BACKGROUND_TOLERANCE &&
    Math.abs(s.g - colour.g) <= BACKGROUND_TOLERANCE &&
    Math.abs(s.b - colour.b) <= BACKGROUND_TOLERANCE).length;
  return { colour, uniform: near / samples.length >= 0.9 };
}

/** 1 where the pixel is NOT the background. All ones when there is no background. */
export function subjectMask(
  px: Uint8Array | Buffer,
  w: number,
  h: number,
  bg: Rgb | null,
): Uint8Array {
  const out = new Uint8Array(w * h);
  if (!bg) { out.fill(1); return out; }
  for (let i = 0; i < w * h; i++) {
    const p = i * 3;
    out[i] = (Math.abs(px[p]! - bg.r) > BACKGROUND_TOLERANCE ||
              Math.abs(px[p + 1]! - bg.g) > BACKGROUND_TOLERANCE ||
              Math.abs(px[p + 2]! - bg.b) > BACKGROUND_TOLERANCE) ? 1 : 0;
  }
  return out;
}

/**
 * Shrink a mask inward, dropping everything within `radius` of its boundary.
 *
 * THE load-bearing step. The silhouette is where the background flip lands, and
 * it is also where antialiasing puts a band of blended pixels that differ
 * whenever anything behind them moves. Neither says whether the character
 * survived, so neither is measured.
 */
export function erodeMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let keep = 1;
      for (let dy = -radius; dy <= radius && keep; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          // Off-frame counts as not-subject, so a subject running off the edge
          // is eroded there too rather than treated as interior.
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) { keep = 0; break; }
        }
      }
      out[y * w + x] = keep;
    }
  }
  return out;
}

export function intersectMasks(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] && b[i] ? 1 : 0;
  return out;
}

/** Did the ground itself change? Reported, never scored. */
export function backgroundChanged(before: Rgb, after: Rgb): boolean {
  return Math.abs(before.r - after.r) > BACKGROUND_TOLERANCE ||
         Math.abs(before.g - after.g) > BACKGROUND_TOLERANCE ||
         Math.abs(before.b - after.b) > BACKGROUND_TOLERANCE;
}

/**
 * A one-line summary for the report.
 *
 * Names what was left as well as what was taken. A compliance tool that reports
 * only its successes reads as an all-clear, which is the omission defect the
 * scanner already had to fix once.
 */
export function formatRetouchPlan(assetName: string, plan: RetouchPlan): string {
  const taking = plan.removing.map(f => `${f.mark}@${f.where}`).join(", ");
  const leaving = plan.skipped.length > 0
    ? `  ·  leaving: ${plan.skipped.map(s => `${s.mark} (${s.reason})`).join("; ")}`
    : "";
  return `  ${assetName.slice(0, 48).padEnd(48)}  removing: ${taking}${leaving}`;
}
