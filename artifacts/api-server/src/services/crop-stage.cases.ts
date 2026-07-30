/**
 * Stage 05 crop cases, shared by the vitest suite and the tsx runner.
 *
 * The point of the stage is that a crop is not a resize, so the assertions that
 * matter are the ones about platform furniture: a frame that is geometrically
 * correct and puts the subject under TikTok's action rail is a failed crop, and
 * the only way anyone finds out in time is if we say so here.
 */

import {
  CROP_TARGETS,
  DEFAULT_FOCAL,
  HOOK_ANCHOR,
  cropRect,
  cropWarnings,
  planCrops,
  pointInCrop,
  pointInFrame,
  underSafeArea,
  type CropTarget,
} from "./crop-stage.js";

export interface Case { name: string; ok: boolean; detail?: unknown }

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const tiktok = CROP_TARGETS.find(t => t.platform === "tiktok")!;
const feed = CROP_TARGETS.find(t => t.platform === "instagram_feed")!;

export async function collectCropStageCases(): Promise<Case[]> {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // --------------------------------------------------------- the geometry
  {
    const square = cropRect(1, 1, { x: 0.5, y: 0.5 });
    check("a same-aspect crop takes the whole frame",
      near(square.width, 1) && near(square.height, 1) && near(square.x, 0) && near(square.y, 0), square);

    const portrait = cropRect(1, 9 / 16, { x: 0.5, y: 0.5 });
    check("a narrower target keeps full height and crops the sides",
      near(portrait.height, 1) && portrait.width < 1, portrait);

    const wide = cropRect(1, 16 / 9, { x: 0.5, y: 0.5 });
    check("a wider target keeps full width and crops top and bottom",
      near(wide.width, 1) && wide.height < 1, wide);
  }
  check("the crop never overhangs the source, so nothing needs letterboxing", (() => {
    const focals = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 0.05 }, { x: 0.95, y: 0.5 }];
    return focals.every(f => {
      const r = cropRect(1, 9 / 16, f);
      return r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.width <= 1 + 1e-9 && r.y + r.height <= 1 + 1e-9;
    });
  })());
  check("a focal point at the very top pins the crop to the top rather than overhanging",
    near(cropRect(1, 16 / 9, { x: 0.5, y: 0 }).y, 0));
  check("an out-of-range focal is clamped rather than trusted",
    cropRect(1, 16 / 9, { x: 5, y: -3 }).y >= 0);

  // ------------------------------------------- the default is not the centre
  /*
   * These renders are centred figures shot head to toe, so the face sits ABOVE
   * the middle. Cropping around the geometric centre reliably cuts heads.
   */
  check("the default focal sits above centre, because heads do", DEFAULT_FOCAL.y < 0.5);
  check("the default focal is horizontally centred", near(DEFAULT_FOCAL.x, 0.5));
  check("a 16:9 crop at the default keeps the face in frame", (() => {
    const r = cropRect(1, 16 / 9, DEFAULT_FOCAL);
    return pointInCrop(DEFAULT_FOCAL, r);
  })());

  // ------------------------------------------------------ frame coordinates
  {
    const r = cropRect(1, 9 / 16, { x: 0.5, y: 0.5 });
    const framed = pointInFrame({ x: 0.5, y: 0.5 }, r);
    check("the focal maps to the middle of its own frame",
      near(framed.x, 0.5) && near(framed.y, 0.5), framed);
  }
  check("a point outside the crop is reported as outside",
    !pointInCrop({ x: 0.01, y: 0.5 }, cropRect(1, 9 / 16, { x: 0.9, y: 0.5 })));

  // ------------------------------------------------------- platform chrome
  check("TikTok has an action rail on the right", tiktok.safeAreas.some(a => a.edge === "right"));
  check("TikTok has a caption block on the bottom", tiktok.safeAreas.some(a => a.edge === "bottom"));
  check("the Instagram FEED has no in-image furniture, because its chrome is outside the picture",
    feed.safeAreas.length === 0);
  check("every safe area says what is actually there, so a warning can name it",
    CROP_TARGETS.every(t => t.safeAreas.every(a => a.what.length > 3)));
  check("every safe area covers a real fraction of the frame",
    CROP_TARGETS.every(t => t.safeAreas.every(a => a.fraction > 0 && a.fraction < 0.5)));

  check("a point low in the frame is under a bottom safe area",
    underSafeArea({ x: 0.5, y: 0.95 }, { edge: "bottom", fraction: 0.24, what: "x" }));
  check("a point in the middle is under nothing",
    !underSafeArea({ x: 0.5, y: 0.5 }, { edge: "bottom", fraction: 0.24, what: "x" }));
  check("a point far right is under a right rail",
    underSafeArea({ x: 0.95, y: 0.5 }, { edge: "right", fraction: 0.17, what: "x" }));

  // -------------------------------------------------------------- warnings
  {
    const focal = { x: 0.5, y: 0.95 };
    const rect = cropRect(1, tiktok.aspect, focal);
    const w = cropWarnings({ target: tiktok, rect, focal, hasHook: false });
    check("a subject low in a TikTok frame is flagged as covered",
      w.some(x => x.kind === "focal_covered"), w);
    check("the warning names the furniture rather than saying 'unsafe area'",
      w.some(x => x.message.includes("caption block")), w);
  }
  check("a clean crop produces no warnings", (() => {
    const focal = DEFAULT_FOCAL;
    const rect = cropRect(1, feed.aspect, focal);
    return cropWarnings({ target: feed, rect, focal, hasHook: true }).length === 0;
  })());
  check("the hook is flagged on TikTok, because it sits where the caption block goes", (() => {
    const rect = cropRect(1, tiktok.aspect, DEFAULT_FOCAL);
    const w = cropWarnings({ target: tiktok, rect, focal: DEFAULT_FOCAL, hasHook: true });
    return w.some(x => x.kind === "hook_covered");
  })());
  check("no hook means no hook warning", (() => {
    const rect = cropRect(1, tiktok.aspect, DEFAULT_FOCAL);
    return cropWarnings({ target: tiktok, rect, focal: DEFAULT_FOCAL, hasHook: false })
      .every(x => x.kind !== "hook_covered");
  })());
  check("the hook anchor sits low, matching where stage 04 draws it", HOOK_ANCHOR.y > 0.7);
  check("a focal cropped out entirely short-circuits to one clear warning", (() => {
    const target: CropTarget = { ...tiktok };
    const rect = { x: 0, y: 0, width: 0.2, height: 0.2 };
    const w = cropWarnings({ target, rect, focal: { x: 0.9, y: 0.9 }, hasHook: true });
    return w.length === 1 && w[0]!.kind === "focal_cropped_out";
  })());

  // ------------------------------------------------------------- planning
  {
    const plans = planCrops({ sourceAspect: 1, hasHook: true });
    check("one focal point plans every channel", plans.length === CROP_TARGETS.length);
    check("each plan carries its own frame and its own warnings",
      plans.every(p => typeof p.rect.width === "number" && Array.isArray(p.warnings)));
    check("the feed plan is clean while TikTok is not, which is the whole point of the stage",
      plans.find(p => p.target.platform === "instagram_feed")!.warnings.length === 0 &&
      plans.find(p => p.target.platform === "tiktok")!.warnings.length > 0);
  }

  return cases;
}
