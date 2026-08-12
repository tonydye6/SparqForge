/**
 * Stage 03 · Refine · finding where each layer IS.
 *
 * Increment 5b. The cast (`take-layers.ts`) says WHO is in a picture and from
 * which real file. This says WHERE, which is the whole point: Tony's ask is
 * "change just that one thing", and a layer is only useful if it carries a
 * region tight enough to scope a generative edit to.
 *
 * ---------------------------------------------------------------------------
 * DETECT BLIND, THEN ATTRIBUTE — and this reverses what doc 45 planned.
 *
 * The plan (and I repeated it before testing it) was to STEER the vision pass
 * with the known cast, on the theory that telling it the picture contains
 * `Crown-U_Mark_Gold.png` is what makes it answer "Crown U Mark" rather than
 * "logo". A controlled A/B on the same take says otherwise
 * (`scripts/probe-layer-detection.ts`, five runs on the demo post):
 *
 *   |                  | steered (n=3) | blind (n=2)                  |
 *   |------------------|---------------|------------------------------|
 *   | layers found     | 3, 3, 3       | 4, 5                         |
 *   | mark named       | Crown U Mark  | Crown U Mark — every time    |
 *   | character named  | Crown U ...   | "Female Tennis Player"       |
 *   | extras found     | none          | frame border, slash device   |
 *
 * The mark is legible IN the picture, so the model reads the brand off it
 * unaided. And the hint SUPPRESSES discovery — it reads as a checklist and the
 * model stops looking. Steering's only real gain was a franchise-specific
 * character name, and attribution recovers that for free.
 *
 * So: detect with no hint, then match the rows back to the cast afterwards. The
 * detected BOX wins (it is the new information); the cast's NAME and FILE win
 * (they are authoritative). The match is a function you can read and test,
 * rather than a hope buried in a prompt.
 *
 * Geometry was the thing worth verifying and it holds: across all five probe
 * runs the mark box landed within 0.002 of itself and the character box began
 * at x=0.417 every single time. The overlays were looked at, not just parsed.
 * ---------------------------------------------------------------------------
 */
import type { LayerKind } from "@workspace/db";
import type { TakeLayer } from "./take-layers.js";

/**
 * A box covering this much of the frame is the base restated, not a layer.
 *
 * Every probe run returned a whole-frame row — "Background", "Background
 * Canvas", "Background Panel" — despite the prompt forbidding it. Enforced in
 * CODE rather than by asking the prompt again, the same choice `normalizeShots`
 * made for the shot list: a model that ignores an instruction once will ignore
 * it again, and a rule in code is testable.
 */
export const FULL_FRAME_AREA = 0.95;

/**
 * Above this, a "scoped" edit touches most of the picture anyway.
 *
 * A diagonal slash across the frame is a real, separable element whose BOUNDING
 * BOX is unavoidably huge. Dropping it would lose a layer somebody legitimately
 * wants; pretending its box is tight would promise a scope it cannot keep. So
 * it is kept and flagged, and the disclosure travels with the row.
 */
export const BROAD_AREA = 0.6;

/** Below this a box is a misclick's worth of pixels — the region-edit floor. */
export const MIN_LAYER_AREA = 0.0004;

/** More than this and the list stops being a list somebody reads. */
export const MAX_LAYERS = 9;

export const DETECTION_PROMPT = `You are decomposing a marketing image into EDITABLE LAYERS, the way
a designer would rebuild it so that ONE element can be restyled without touching the others.

Return ONLY a JSON array, ordered BACK TO FRONT (the element furthest back first):
[{"name": "...", "role": "background|character|mark|typography|device|object",
  "box_2d": [ymin, xmin, ymax, xmax]}]

Rules:
- "name" must be a HUMAN-READABLE SEMANTIC NAME describing the element's ROLE in the composition
  ("Crown U Mark", "Left Female Athlete", "Diagonal Slash Device", "Main Headline"). Never "layer 1",
  never "object", never a bare colour.
- Separate characters from EACH OTHER. Separate graphic and typographic furniture from the art.
- box_2d is [ymin, xmin, ymax, xmax], each 0-1000, normalised to the image.
- Boxes must be TIGHT. This box will scope a generative edit, so a box that swallows a neighbour
  means somebody's edit changes the wrong thing.
- Do NOT invent elements that are not visible.
- Do NOT return a layer that covers the whole image. The background is already known.
- Between 1 and ${MAX_LAYERS} layers.`;

/** One row as the model returns it, before anything is trusted. */
interface RawDetected {
  name?: unknown;
  role?: unknown;
  box_2d?: unknown;
}

export interface DetectedLayer {
  name: string;
  kind: LayerKind;
  bbox: { x: number; y: number; w: number; h: number };
  /** True when the box covers so much of the frame that "scoped" oversells it. */
  broad: boolean;
}

/** The model's `role` vocabulary onto the schema's, with an honest default. */
const KIND_BY_ROLE: Record<string, LayerKind> = {
  background: "background",
  character: "character",
  person: "character",
  mark: "mark",
  logo: "mark",
  typography: "typography",
  text: "typography",
  headline: "typography",
  device: "device",
  graphic: "device",
  object: "element",
};

/** Gemini's documented order is [ymin, xmin, ymax, xmax], 0..1000. */
function boxToFraction(raw: unknown): DetectedLayer["bbox"] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums = raw.map(n => Number(n));
  if (!nums.every(Number.isFinite)) return null;
  const [ymin, xmin, ymax, xmax] = nums.map(n => Math.min(1000, Math.max(0, n)));
  const x = xmin / 1000;
  const y = ymin / 1000;
  const w = (xmax - xmin) / 1000;
  const h = (ymax - ymin) / 1000;
  if (w <= 0 || h <= 0) return null;
  // Clamp the far edge rather than the size, matching normalizeRegion: a box
  // whose origin is in frame keeps its origin.
  return {
    x,
    y,
    w: x + w > 1 ? 1 - x : w,
    h: y + h > 1 ? 1 - y : h,
  };
}

/**
 * What the model returned, reduced to rows that can safely scope an edit.
 *
 * Malformed rows are DROPPED, never repaired — the same rule `normalizeRegion`
 * states: a silently widened box edits pixels nobody selected, and no report
 * afterwards can undo that.
 */
export function normalizeDetected(parsed: unknown): DetectedLayer[] {
  const rows: RawDetected[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { layers?: unknown })?.layers)
      ? (parsed as { layers: RawDetected[] }).layers
      : [];

  const out: DetectedLayer[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row?.name !== "string" || row.name.trim().length === 0) continue;
    const name = row.name.trim().slice(0, 80);
    const bbox = boxToFraction(row.box_2d);
    if (!bbox) continue;

    const area = bbox.w * bbox.h;
    if (area < MIN_LAYER_AREA) continue;
    // The base restated. Nothing to select, nothing to scope.
    if (area >= FULL_FRAME_AREA) continue;

    const role = typeof row.role === "string" ? row.role.toLowerCase().trim() : "";
    const kind = KIND_BY_ROLE[role] ?? "element";
    // A background-kind row that survived the area gate is not a background.
    const settled: LayerKind = kind === "background" ? "device" : kind;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ name, kind: settled, bbox, broad: area > BROAD_AREA });
    if (out.length >= MAX_LAYERS) break;
  }
  return out;
}

/** Words that carry no signal when comparing two element names. */
const STOPWORDS = new Set(["the", "a", "an", "of", "and", "graphic", "device", "layer", "image"]);

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOPWORDS.has(t)),
  );
}

/** Shared meaningful words, as a fraction of the smaller name. */
export function nameOverlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

export interface AttributedLayer extends DetectedLayer {
  /** The cast member this row was matched to, when one accounts for it. */
  assetId: string | null;
  /** Kept so the walk can see WHY a row was attributed. */
  matchedBy: "kind" | "name" | null;
}

/** A detected kind and a cast layer kind describing the same sort of thing. */
const KIND_EQUIVALENT: Partial<Record<LayerKind, TakeLayer["kind"]>> = {
  mark: "mark",
  character: "subject",
};

/**
 * Match detected rows back to the known cast.
 *
 * The detected BOX always wins — it is the new information, and it is what the
 * cast could never supply. The cast's NAME and FILE win where they apply,
 * because they are authoritative: a mark layer named off the real
 * `Crown-U_Mark_Gold.png` is a fact, while a name the model read off the
 * pixels is a reading.
 *
 * Matching is one-to-one and greedy on the strongest signal first: an unambiguous
 * kind, then name overlap. Where it is ambiguous NOTHING is matched, because a
 * wrong attribution would put the wrong file behind a layer and 5c would hand
 * that file to a generative edit.
 */
export function attributeToCast(detected: DetectedLayer[], cast: TakeLayer[]): AttributedLayer[] {
  const castByKind = new Map<TakeLayer["kind"], TakeLayer[]>();
  for (const c of cast) {
    if (c.kind === "base") continue;
    const list = castByKind.get(c.kind) ?? [];
    list.push(c);
    castByKind.set(c.kind, list);
  }

  const used = new Set<string>();
  const result: AttributedLayer[] = detected.map(d => ({ ...d, assetId: null, matchedBy: null }));

  // Pass 1 — an unambiguous kind on BOTH sides. One detected mark and one cast
  // mark can only mean each other.
  for (const row of result) {
    const wanted = KIND_EQUIVALENT[row.kind];
    if (!wanted) continue;
    const candidates = (castByKind.get(wanted) ?? []).filter(c => c.assetId && !used.has(c.assetId));
    const detectedOfKind = result.filter(r => r.kind === row.kind).length;
    if (candidates.length === 1 && detectedOfKind === 1) {
      const hit = candidates[0];
      row.assetId = hit.assetId;
      row.name = hit.name;
      row.matchedBy = "kind";
      used.add(hit.assetId!);
    }
  }

  // Pass 2 — name overlap, for the ambiguous cases pass 1 refused.
  for (const row of result) {
    if (row.assetId) continue;
    let best: { layer: TakeLayer; score: number } | null = null;
    for (const c of cast) {
      if (c.kind === "base" || !c.assetId || used.has(c.assetId)) continue;
      const score = nameOverlap(row.name, c.name);
      if (score >= 0.5 && (!best || score > best.score)) best = { layer: c, score };
    }
    if (best) {
      row.assetId = best.layer.assetId;
      row.name = best.layer.name;
      row.matchedBy = "name";
      used.add(best.layer.assetId!);
    }
  }

  return result;
}

/**
 * How a layer-scoped edit is described to the model — increment 5c.
 *
 * THIS IS WHY LAYERS BEAT A DRAWN BOX ON THIS SURFACE. The Interactions API
 * does SEMANTIC masking rather than accepting a bitmap, so `region-edit` has to
 * turn geometry into words and the best it can manage from a hand-drawn
 * rectangle is "a small area in the upper left" (`describeRegion`). A layer
 * carries a NAME as well as a place, so the same edit becomes "the Crown U
 * Mark, a small area in the upper left" — which identifies the thing rather
 * than the coordinates it happens to occupy. A model given a name can tell the
 * mark from the shoulder behind it; a model given a rectangle cannot.
 *
 * The name goes FIRST because it is the stronger signal, and the place stays
 * because it disambiguates when a picture holds two of the same thing.
 */
export function layerScopeSentence(layerName: string, where: string, instruction: string): string {
  const said = instruction.trim().replace(/\s+/g, " ");
  const ended = /[.!?]$/.test(said) ? said : `${said}.`;
  return `Change only the ${layerName} — ${where}. ${ended} ` +
    "Everything else in the image, including every other element and the background, stays exactly as it is.";
}

/**
 * The sentence the panel shows after a decomposition.
 *
 * Assembled here so the count, the attribution and the broad-box caveat cannot
 * disagree with each other across a client refactor — the same reason the
 * storyboard read model owns its own price.
 */
export function detectionSummary(layers: AttributedLayer[]): string {
  if (layers.length === 0) {
    return "Nothing separable was found in this picture, so it stays one layer.";
  }
  const attributed = layers.filter(l => l.assetId).length;
  const broad = layers.filter(l => l.broad).length;
  const noun = layers.length === 1 ? "layer" : "layers";
  let s = `${layers.length} ${noun} found`;
  if (attributed > 0) s += `, ${attributed} matched to a file you attached`;
  s += ".";
  if (broad > 0) {
    s += ` ${broad === 1 ? "One covers" : `${broad} cover`} most of the frame, so editing ` +
      `${broad === 1 ? "it" : "them"} will not stay in a corner.`;
  }
  return s;
}
