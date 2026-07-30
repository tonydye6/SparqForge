/**
 * Stage 05 · Channel crops. NOT resizing.
 *
 * The distinction is the whole stage. Every platform covers part of your picture
 * with its own interface: TikTok puts an action rail down the right and a
 * caption block across the bottom, a Story puts a profile row on top and a reply
 * bar underneath. A "resize" that only changes aspect ratio hands you an image
 * whose subject is sitting under a comment button, and you find out after
 * publishing.
 *
 * So this stage does three things a resizer does not: it reframes around a focal
 * point rather than the geometric centre, it knows where each platform's chrome
 * actually sits, and it FLAGS a collision before publishing rather than after.
 *
 * Honest about its limits. The takes stage 03 produces live in `stage_takes` and
 * carry no subject box, so the focal point starts as a sensible default and is
 * yours to nudge; the safe areas below are the platforms' real furniture, but
 * they are approximations of a moving target and are stated as guidance rather
 * than as a guarantee.
 *
 * No DB, no clock, no randomness.
 */

export interface SafeArea {
  /** Which edge the platform's furniture is attached to. */
  edge: "top" | "bottom" | "left" | "right";
  /** Fraction of the cropped frame it covers, 0-1. */
  fraction: number;
  /** What is actually there, in words, so a warning can name it. */
  what: string;
}

export interface CropTarget {
  platform: string;
  label: string;
  /** width / height. */
  aspect: number;
  aspectLabel: string;
  safeAreas: SafeArea[];
}

/**
 * The real furniture, per platform.
 *
 * Feed placements mostly render chrome OUTSIDE the image, which is why X and the
 * Instagram feed carry little here. Full-bleed placements draw over the picture,
 * which is where crops actually go wrong.
 */
export const CROP_TARGETS: CropTarget[] = [
  {
    platform: "instagram_feed",
    label: "Instagram feed",
    aspect: 4 / 5,
    aspectLabel: "4:5",
    safeAreas: [],
  },
  {
    platform: "instagram_story",
    label: "Instagram story",
    aspect: 9 / 16,
    aspectLabel: "9:16",
    safeAreas: [
      { edge: "top", fraction: 0.14, what: "the profile row and close button" },
      { edge: "bottom", fraction: 0.2, what: "the reply bar" },
    ],
  },
  {
    platform: "tiktok",
    label: "TikTok",
    aspect: 9 / 16,
    aspectLabel: "9:16",
    safeAreas: [
      { edge: "right", fraction: 0.17, what: "the action rail" },
      { edge: "bottom", fraction: 0.24, what: "the caption block and username" },
      { edge: "top", fraction: 0.09, what: "the following/for-you tabs" },
    ],
  },
  {
    platform: "twitter",
    label: "X",
    aspect: 16 / 9,
    aspectLabel: "16:9",
    safeAreas: [],
  },
];

/** Normalised point in the SOURCE image, 0-1 from the top left. */
export interface Focal {
  x: number;
  y: number;
}

/**
 * Where a hero subject usually sits, and why it is not 0.5.
 *
 * These renders are centred figures shot head to toe, so the face — the thing
 * that must survive a crop — sits above the middle. Cropping around the
 * geometric centre reliably cuts heads on 16:9.
 */
export const DEFAULT_FOCAL: Focal = { x: 0.5, y: 0.42 };

export interface CropRect {
  /** All values are fractions of the source, 0-1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * The largest rectangle of `targetAspect` that fits inside the source, centred
 * on the focal point and then pushed back inside the edges.
 *
 * Clamping rather than letting it overhang is what keeps the crop full-bleed. An
 * overhanging rect would need letterboxing, and a letterboxed social post reads
 * as a mistake.
 */
export function cropRect(sourceAspect: number, targetAspect: number, focal: Focal): CropRect {
  let width = 1;
  let height = 1;
  if (targetAspect < sourceAspect) {
    // Target is narrower: full height, crop the sides.
    width = targetAspect / sourceAspect;
  } else if (targetAspect > sourceAspect) {
    // Target is wider: full width, crop top and bottom.
    height = sourceAspect / targetAspect;
  }
  const x = clamp01(clamp01(focal.x) - width / 2);
  const y = clamp01(clamp01(focal.y) - height / 2);
  return {
    x: Math.min(x, 1 - width),
    y: Math.min(y, 1 - height),
    width,
    height,
  };
}

/** Is a source-space point inside the crop at all? */
export function pointInCrop(point: Focal, rect: CropRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** Re-express a source-space point in the cropped frame's own coordinates. */
export function pointInFrame(point: Focal, rect: CropRect): Focal {
  return {
    x: (point.x - rect.x) / rect.width,
    y: (point.y - rect.y) / rect.height,
  };
}

/** Does a framed point fall under a platform's furniture? */
export function underSafeArea(framed: Focal, area: SafeArea): boolean {
  if (area.edge === "top") return framed.y < area.fraction;
  if (area.edge === "bottom") return framed.y > 1 - area.fraction;
  if (area.edge === "left") return framed.x < area.fraction;
  return framed.x > 1 - area.fraction;
}

export interface CropWarning {
  platform: string;
  /** Written for a person, naming what is covering what (§1.14). */
  message: string;
  kind: "focal_covered" | "focal_cropped_out" | "hook_covered";
}

/**
 * Where the hook layer sits in the frame, matching how stage 04 draws it.
 *
 * Kept as a constant rather than measured, because the compositor places it and
 * this stage only needs to know whether that placement collides with chrome.
 */
export const HOOK_ANCHOR: Focal = { x: 0.5, y: 0.9 };

/**
 * Everything wrong with one channel's crop, before it is published.
 *
 * Warnings, never blocks. A user may well decide the mark can sit under the
 * caption block on TikTok; what they must not do is find out afterwards.
 */
export function cropWarnings(params: {
  target: CropTarget;
  rect: CropRect;
  focal: Focal;
  hasHook: boolean;
}): CropWarning[] {
  const { target, rect, focal, hasHook } = params;
  const out: CropWarning[] = [];

  if (!pointInCrop(focal, rect)) {
    out.push({
      platform: target.platform,
      kind: "focal_cropped_out",
      message: `The subject falls outside the ${target.aspectLabel} crop entirely. Nudge the frame toward it.`,
    });
    return out;
  }

  const framedFocal = pointInFrame(focal, rect);
  for (const area of target.safeAreas) {
    if (underSafeArea(framedFocal, area)) {
      out.push({
        platform: target.platform,
        kind: "focal_covered",
        message: `The subject falls under ${area.what}. Nudge it clear, or accept and lose it.`,
      });
    }
  }

  if (hasHook) {
    for (const area of target.safeAreas) {
      if (underSafeArea(HOOK_ANCHOR, area)) {
        out.push({
          platform: target.platform,
          kind: "hook_covered",
          message: `The hook sits under ${area.what}. It will need to reflow higher for this channel.`,
        });
      }
    }
  }

  return out;
}

/** One channel's finished plan: the frame, and what is wrong with it. */
export interface ChannelCrop {
  target: CropTarget;
  rect: CropRect;
  warnings: CropWarning[];
}

/**
 * Plan every channel from one focal point.
 *
 * One focal point drives all four, which is why nudging is a single gesture
 * rather than four. This is also where the Pipeline's ×N badge comes from: one
 * creative, N channel outputs.
 */
export function planCrops(params: {
  sourceAspect: number;
  focal?: Focal;
  hasHook?: boolean;
  targets?: CropTarget[];
}): ChannelCrop[] {
  const focal = params.focal ?? DEFAULT_FOCAL;
  const targets = params.targets ?? CROP_TARGETS;
  return targets.map((target) => {
    const rect = cropRect(params.sourceAspect, target.aspect, focal);
    return { target, rect, warnings: cropWarnings({ target, rect, focal, hasHook: params.hasHook ?? false }) };
  });
}
