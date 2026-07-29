/**
 * Stage 03 · region editing · the region model and the drift report.
 *
 * Spec: `22_IMPLEMENTATION_PLAN.md` Phase 4 item 4, `21_SPEC_01_DATA_MODEL.md`
 * §4.4, and `20_SPEC_00_PRINCIPLES.md` §1.13 and §1.17.
 *
 * Two jobs, both pure, so the geometry and the arithmetic are testable without a
 * model or an image.
 *
 * NAMED REGIONS. A user should be able to say "the background" without drawing
 * it. `creative_variants.subjectBox` already exists and already knows where the
 * subject is, so Subject and Background are derivable rather than drawn. Box,
 * lasso and point stay available for everything the names do not cover.
 *
 * THE DRIFT REPORT. Every masked-edit feature has the same failure mode: the
 * model repaints the whole frame while claiming to have touched one corner. So
 * drift measures what changed OUTSIDE the mask, not inside it. Inside is what
 * was asked for; outside is the damage. §1.17 says it must be inspectable rather
 * than trusted, which is why it is reported as a number with a verdict and not
 * silently accepted.
 *
 * All coordinates are normalised 0..1 fractions of the frame, never pixels, so a
 * region survives the same edit being applied at a different resolution or aspect.
 */

export type RegionShape = "box" | "lasso" | "point";

export interface Point {
  x: number;
  y: number;
}

export interface BoxRegion {
  shape: "box";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LassoRegion {
  shape: "lasso";
  points: Point[];
}

export interface PointRegion {
  shape: "point";
  x: number;
  y: number;
  /** Radius as a fraction of the shorter frame edge. */
  r: number;
}

export type Region = BoxRegion | LassoRegion | PointRegion;

export interface NamedRegion {
  key: string;
  label: string;
  region: Region;
  /** Where the name came from, so the UI never implies the user drew it. */
  source: "subject_box" | "derived" | "mark_placement";
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A lasso below this many points is a scribble, not an area. */
export const MIN_LASSO_POINTS = 3;
/** Smaller than this and the mask is almost certainly a misclick. */
export const MIN_REGION_AREA = 0.0004;

/**
 * Clamp a region into the frame and reject degenerate ones.
 *
 * Returns null rather than repairing a bad region. A silently widened mask would
 * edit pixels the user did not select, which is the exact harm the drift report
 * exists to detect, so it must not be introduced here on purpose.
 */
export function normalizeRegion(raw: unknown): Region | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  if (r.shape === "box") {
    const x = Number(r.x);
    const y = Number(r.y);
    const w = Number(r.w);
    const h = Number(r.h);
    if (![x, y, w, h].every(Number.isFinite)) return null;
    // Clamp the far edge, not the size, so a box drawn off-frame keeps its
    // origin. Only recompute when the edge actually falls outside the frame:
    // `clamp01(x + w) - x` is not exactly `w` in binary floating point, and
    // introducing that error on every in-frame box would mean a mask never quite
    // matched the numbers the user was shown.
    const cx = clamp01(x);
    const cy = clamp01(y);
    const aw = Math.abs(w);
    const ah = Math.abs(h);
    const cw = cx + aw > 1 ? 1 - cx : aw;
    const ch = cy + ah > 1 ? 1 - cy : ah;
    if (cw * ch < MIN_REGION_AREA) return null;
    return { shape: "box", x: cx, y: cy, w: cw, h: ch };
  }

  if (r.shape === "lasso") {
    if (!Array.isArray(r.points)) return null;
    const points: Point[] = [];
    for (const p of r.points) {
      if (!p || typeof p !== "object") continue;
      const px = Number((p as Record<string, unknown>).x);
      const py = Number((p as Record<string, unknown>).y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      points.push({ x: clamp01(px), y: clamp01(py) });
    }
    if (points.length < MIN_LASSO_POINTS) return null;
    if (polygonArea(points) < MIN_REGION_AREA) return null;
    return { shape: "lasso", points };
  }

  if (r.shape === "point") {
    const x = Number(r.x);
    const y = Number(r.y);
    const rad = Number(r.r);
    if (![x, y, rad].every(Number.isFinite)) return null;
    const cr = Math.min(0.5, Math.abs(rad));
    if (Math.PI * cr * cr < MIN_REGION_AREA) return null;
    return { shape: "point", x: clamp01(x), y: clamp01(y), r: cr };
  }

  return null;
}

/** Shoelace area of a normalised polygon. */
export function polygonArea(points: Point[]): number {
  if (points.length < MIN_LASSO_POINTS) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Fraction of the frame a region covers. */
export function regionAreaFraction(region: Region): number {
  switch (region.shape) {
    case "box":
      return region.w * region.h;
    case "lasso":
      return polygonArea(region.points);
    case "point":
      return Math.PI * region.r * region.r;
  }
}

export interface SubjectBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Read `creative_variants.subjectBox`, which is untyped json. */
export function parseSubjectBox(raw: unknown): SubjectBox | null {
  const box = normalizeRegion({ shape: "box", ...(raw as object) });
  return box && box.shape === "box" ? { x: box.x, y: box.y, w: box.w, h: box.h } : null;
}

/**
 * The regions a user can name instead of draw.
 *
 * Background is deliberately expressed as the subject box carrying an `invert`
 * intent at the call site rather than as a polygon with a hole: a hole is not
 * representable in any of the three shapes, and faking one with a lasso would
 * produce a mask that does not mean what it says.
 */
export function namedRegionsFrom(
  subjectBoxRaw: unknown,
  markPlacement?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | null,
): NamedRegion[] {
  const out: NamedRegion[] = [];
  const subject = parseSubjectBox(subjectBoxRaw);

  if (subject) {
    out.push({
      key: "subject",
      label: "The subject",
      region: { shape: "box", ...subject },
      source: "subject_box",
    });
  }

  if (markPlacement) {
    // A corner sized to the brand mark's usual footprint, so "the logo" is
    // selectable without the user drawing a small box in a corner every time.
    const size = 0.22;
    const x = markPlacement.endsWith("left") ? 0 : 1 - size;
    const y = markPlacement.startsWith("top") ? 0 : 1 - size;
    out.push({
      key: "mark",
      label: "The mark",
      region: { shape: "box", x, y, w: size, h: size },
      source: "mark_placement",
    });
  }

  return out;
}

// ---------------------------------------------------------------------- drift

/**
 * Drift above this is reported as a problem rather than noise.
 *
 * Recompression alone moves a few percent of pixels by a pixel value or two, so
 * a zero tolerance would flag every successful edit. Eight percent is generous
 * enough to absorb that and tight enough to catch a model that re-rendered the
 * background while claiming to have changed a jersey.
 */
export const DRIFT_TOLERANCE = 8;

export type DriftVerdict = "clean" | "notable" | "repainted";

/**
 * Drift as a percentage of the area OUTSIDE the mask that changed.
 *
 * Outside, not overall: an edit is supposed to change what is inside the mask, so
 * counting that would report a successful edit as maximum drift. Returns 0 when
 * there is nothing outside the mask to drift, because a whole-frame mask cannot
 * drift by definition and reporting NaN would poison every comparison downstream.
 */
export function computeDriftPercent(changedOutsideMask: number, totalOutsideMask: number): number {
  if (!Number.isFinite(changedOutsideMask) || !Number.isFinite(totalOutsideMask)) return 0;
  if (totalOutsideMask <= 0) return 0;
  const pct = (Math.max(0, changedOutsideMask) / totalOutsideMask) * 100;
  // Round to one decimal: this is reported to a person, and a figure like
  // 3.7194% implies a precision the pixel comparison does not have.
  return Math.min(100, Math.round(pct * 10) / 10);
}

export function driftVerdict(driftPercent: number): DriftVerdict {
  if (driftPercent <= DRIFT_TOLERANCE) return "clean";
  if (driftPercent <= 30) return "notable";
  return "repainted";
}

/**
 * What the drift report says out loud.
 *
 * §1.14: says what it affects and whether action is needed. §1.13: the contract
 * binds the model and advises the human, so this describes rather than blocks.
 * The user may well want the change it is warning about.
 */
export function driftMessage(driftPercent: number): string {
  switch (driftVerdict(driftPercent)) {
    case "clean":
      return `Only your selection changed. ${driftPercent}% of the rest of the frame moved, which is within recompression noise.`;
    case "notable":
      return `${driftPercent}% of the frame changed outside your selection. Worth a look before you keep this.`;
    case "repainted":
      return `${driftPercent}% of the frame changed outside your selection, so this is closer to a re-render than an edit. Keep it if you like it, but it is not the edit you asked for.`;
  }
}
