/**
 * Stage 03 · Image · the Explore plan.
 *
 * Spec: `22_IMPLEMENTATION_PLAN.md` Phase 4 item 3 ("Explore as an 8-take spread
 * on two named axes with off-brief takes flagged not hidden"), plus
 * `20_SPEC_00_PRINCIPLES.md` §1.5, §1.12 and §1.17.
 *
 * This module plans the spread. It never generates it. That separation is the
 * whole point: eight images is real money, so the user sees what would be made,
 * what each take changes, and what it costs, and then decides (§1.5, re-runs are
 * offered and priced, never automatic).
 *
 * Two ideas do the work.
 *
 * NAMED AXES. A spread of eight images with no stated structure is a lottery,
 * and picking from a lottery teaches you nothing. Two named axes make the spread
 * legible: every take sits at a stated position on each axis, so choosing one is
 * a judgement about a direction rather than a reaction to a thumbnail. §1.12
 * says images are the artifact furthest from something you could make by hand,
 * so instruction is the only path; naming the axes is what makes the instruction
 * inspectable.
 *
 * OFF-BRIEF IS FLAGGED, NOT HIDDEN. Each axis is ordered from the brief's own
 * reading outward, and positions past that are marked as departures. A departure
 * is often the most useful take on the board, so hiding it would be the wrong
 * call, and showing it unmarked would be dishonest about what was asked for
 * (§1.17). It is labelled, with the reason, and it stays.
 */

import type { Intent } from "../lib/intents.js";

/** Columns on the horizontal axis. Four positions times two rows is the eight. */
export const AXIS_A_POSITIONS = 4;
/** Rows on the vertical axis. */
export const AXIS_B_POSITIONS = 2;
export const SPREAD_SIZE = AXIS_A_POSITIONS * AXIS_B_POSITIONS;

export interface AxisPosition {
  key: string;
  /** Shown on the grid header. Two or three words, not a sentence. */
  label: string;
  /** Appended to the prompt for every take in this row or column. */
  directive: string;
  /**
   * True when this position goes past what the brief asked for.
   *
   * Set at plan time by whoever defines the axis, not judged after the fact from
   * an image. The planner knows it is pushing outward; inferring it later from a
   * finished picture would be guessing at our own intent.
   */
  departure: boolean;
}

export interface Axis {
  id: "a" | "b";
  /** What the axis varies, named so the spread can be read. */
  name: string;
  positions: AxisPosition[];
}

export interface OffBrief {
  /** Which axes pushed this take past the brief. */
  axes: string[];
  reason: string;
}

export interface ExploreTake {
  id: string;
  /** Zero-based grid coordinates. Column is axis A, row is axis B. */
  col: number;
  row: number;
  axisA: { name: string; label: string };
  axisB: { name: string; label: string };
  /** The two axis directives, joined. Appended to the base prompt. */
  directive: string;
  /** Null when the take sits inside what the brief asked for. */
  offBrief: OffBrief | null;
}

export interface ExplorePlan {
  axes: { a: Axis; b: Axis };
  takes: ExploreTake[];
  costCents: number;
  /** How many of the eight are deliberate departures. */
  offBriefCount: number;
  /** True when the axes came from the fallback rather than a model. */
  fallback: boolean;
}

/**
 * Deterministic axis pairs, one per intent.
 *
 * These are the fallback when the model cannot be reached, and they are also the
 * shape a model-proposed pair is validated against. Every axis reads outward:
 * position 0 is the brief taken literally, and the last position is the furthest
 * defensible departure from it.
 */
export const FALLBACK_AXES: Record<Intent, { a: Axis; b: Axis }> = {
  awareness: {
    a: {
      id: "a",
      name: "Loudness",
      positions: [
        { key: "as_briefed", label: "As briefed", directive: "hold the brief's stated energy", departure: false },
        { key: "louder", label: "Louder", directive: "raise the contrast and the energy a step", departure: false },
        { key: "spectacle", label: "Spectacle", directive: "push to spectacle: bigger gesture, bolder staging", departure: true },
        { key: "stark", label: "Stark", directive: "strip it back to one stark idea, almost austere", departure: true },
      ],
    },
    b: {
      id: "b",
      name: "Distance",
      positions: [
        { key: "mid", label: "Mid shot", directive: "mid distance, the subject legible in context", departure: false },
        { key: "close", label: "Close", directive: "move in close, fill the frame with the subject", departure: false },
      ],
    },
  },
  acquisition: {
    a: {
      id: "a",
      name: "Directness",
      positions: [
        { key: "as_briefed", label: "As briefed", directive: "hold the brief's stated framing", departure: false },
        { key: "plainer", label: "Plainer", directive: "make the offer unmistakable and uncluttered", departure: false },
        { key: "hard_sell", label: "Hard sell", directive: "lead with the offer, everything else subordinate", departure: true },
        { key: "oblique", label: "Oblique", directive: "imply the offer rather than state it, intrigue over clarity", departure: true },
      ],
    },
    b: {
      id: "b",
      name: "Warmth",
      positions: [
        { key: "warm", label: "Warm", directive: "inviting light, approachable staging", departure: false },
        { key: "cool", label: "Cool", directive: "cooler light, precise and premium", departure: false },
      ],
    },
  },
  community_engagement: {
    a: {
      id: "a",
      name: "Who is centred",
      positions: [
        { key: "as_briefed", label: "As briefed", directive: "hold the brief's stated subject", departure: false },
        { key: "the_crowd", label: "The crowd", directive: "centre the community rather than one figure", departure: false },
        { key: "one_face", label: "One face", directive: "centre a single recognisable face, everyone else implied", departure: true },
        { key: "no_one", label: "No one", directive: "no people at all, the object or place carries it", departure: true },
      ],
    },
    b: {
      id: "b",
      name: "Moment",
      positions: [
        { key: "peak", label: "Peak", directive: "the peak of the action", departure: false },
        { key: "aftermath", label: "Aftermath", directive: "the second afterwards, reaction over action", departure: false },
      ],
    },
  },
  recognition_reward: {
    a: {
      id: "a",
      name: "Ceremony",
      positions: [
        { key: "as_briefed", label: "As briefed", directive: "hold the brief's stated tone", departure: false },
        { key: "earned", label: "Earned", directive: "emphasise the effort behind the recognition", departure: false },
        { key: "trophy", label: "Trophy", directive: "full ceremony, unabashed celebration", departure: true },
        { key: "quiet", label: "Quiet", directive: "understated, a private moment of recognition", departure: true },
      ],
    },
    b: {
      id: "b",
      name: "Distance",
      positions: [
        { key: "close", label: "Close", directive: "close on the person being recognised", departure: false },
        { key: "wide", label: "Wide", directive: "wide enough to show who is watching", departure: false },
      ],
    },
  },
  announcement_launch: {
    a: {
      id: "a",
      name: "Reveal",
      positions: [
        { key: "as_briefed", label: "As briefed", directive: "hold the brief's stated reveal", departure: false },
        { key: "full", label: "Full reveal", directive: "show the thing plainly and completely", departure: false },
        { key: "teased", label: "Teased", directive: "partial reveal, withhold the payoff", departure: true },
        { key: "aftermath", label: "Aftermath", directive: "skip the reveal, show the world after it", departure: true },
      ],
    },
    b: {
      id: "b",
      name: "Formality",
      positions: [
        { key: "sharp", label: "Sharp", directive: "clean, composed, announcement-grade", departure: false },
        { key: "raw", label: "Raw", directive: "looser and more immediate, captured not staged", departure: false },
      ],
    },
  },
  education: {
    a: {
      id: "a",
      name: "Explanation",
      positions: [
        { key: "as_briefed", label: "As briefed", directive: "hold the brief's stated approach", departure: false },
        { key: "annotated", label: "Annotated", directive: "make the mechanic visible, diagram-like clarity", departure: false },
        { key: "step_by_step", label: "Step by step", directive: "sequence the idea across the frame", departure: true },
        { key: "single_insight", label: "One insight", directive: "one arresting image that implies the whole lesson", departure: true },
      ],
    },
    b: {
      id: "b",
      name: "Register",
      positions: [
        { key: "plain", label: "Plain", directive: "plain and legible above all", departure: false },
        { key: "stylised", label: "Stylised", directive: "stylised, closer to editorial than instruction", departure: false },
      ],
    },
  },
  retention: {
    a: {
      id: "a",
      name: "Pull",
      positions: [
        { key: "as_briefed", label: "As briefed", directive: "hold the brief's stated hook", departure: false },
        { key: "familiar", label: "Familiar", directive: "lean on what a lapsed player already recognises", departure: false },
        { key: "whats_new", label: "What's new", directive: "lead with what has changed since they left", departure: true },
        { key: "unfinished", label: "Unfinished", directive: "show what they left unfinished, absence as the hook", departure: true },
      ],
    },
    b: {
      id: "b",
      name: "Mood",
      positions: [
        { key: "bright", label: "Bright", directive: "bright and welcoming", departure: false },
        { key: "moody", label: "Moody", directive: "darker, heavier atmosphere", departure: false },
      ],
    },
  },
};

/** Cost of the whole spread, in cents, from the per-image estimate in dollars. */
export function spreadCostCents(perImageUsd: number, takeCount: number = SPREAD_SIZE): number {
  return Math.round(perImageUsd * takeCount * 100);
}

function offBriefFor(a: AxisPosition, b: AxisPosition, axes: { a: Axis; b: Axis }): OffBrief | null {
  const which: string[] = [];
  if (a.departure) which.push(axes.a.name);
  if (b.departure) which.push(axes.b.name);
  if (which.length === 0) return null;

  const parts: string[] = [];
  if (a.departure) parts.push(`${axes.a.name.toLowerCase()} pushed to "${a.label.toLowerCase()}"`);
  if (b.departure) parts.push(`${axes.b.name.toLowerCase()} pushed to "${b.label.toLowerCase()}"`);
  return {
    axes: which,
    reason: `Goes past the brief: ${parts.join(" and ")}.`,
  };
}

/**
 * Lay the eight takes out on the two axes.
 *
 * Reading order is column-major within a row so the grid reads left to right,
 * top to bottom, which is the order the UI renders and therefore the order a
 * person will compare them in.
 */
export function buildExploreGrid(axes: { a: Axis; b: Axis }): ExploreTake[] {
  const takes: ExploreTake[] = [];
  for (let row = 0; row < axes.b.positions.length; row++) {
    for (let col = 0; col < axes.a.positions.length; col++) {
      const a = axes.a.positions[col];
      const b = axes.b.positions[row];
      takes.push({
        id: `${a.key}__${b.key}`,
        col,
        row,
        axisA: { name: axes.a.name, label: a.label },
        axisB: { name: axes.b.name, label: b.label },
        directive: `${a.directive}; ${b.directive}`,
        offBrief: offBriefFor(a, b, axes),
      });
    }
  }
  return takes;
}

/**
 * Accept a model-proposed axis pair, or reject it.
 *
 * Returns null rather than repairing a malformed pair. A half-valid axis would
 * produce a spread whose structure is a lie, and the deterministic fallback is a
 * genuinely good spread, so falling back costs far less than pretending.
 *
 * The rules a proposal must satisfy: the right number of positions on each axis,
 * both axes named, every position labelled with a directive, unique keys, and at
 * least one departure on axis A. That last one matters: an axis with no
 * departure is not an axis, it is four ways of saying the same thing, and the
 * spread would stop exploring anything.
 */
export function validateAxes(raw: unknown): { a: Axis; b: Axis } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const one = (value: unknown, id: "a" | "b", expected: number): Axis | null => {
    if (!value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    const name = typeof v.name === "string" ? v.name.trim() : "";
    if (!name || name.length > 40) return null;
    if (!Array.isArray(v.positions) || v.positions.length !== expected) return null;

    const positions: AxisPosition[] = [];
    const seen = new Set<string>();
    for (const p of v.positions) {
      if (!p || typeof p !== "object") return null;
      const pos = p as Record<string, unknown>;
      const key = typeof pos.key === "string" ? pos.key.trim() : "";
      const label = typeof pos.label === "string" ? pos.label.trim() : "";
      const directive = typeof pos.directive === "string" ? pos.directive.trim() : "";
      if (!key || !label || !directive) return null;
      if (label.length > 24 || directive.length > 200) return null;
      if (seen.has(key)) return null;
      seen.add(key);
      positions.push({ key, label, directive, departure: pos.departure === true });
    }
    return { id, name, positions };
  };

  const a = one(obj.a, "a", AXIS_A_POSITIONS);
  const b = one(obj.b, "b", AXIS_B_POSITIONS);
  if (!a || !b) return null;
  if (!a.positions.some(p => p.departure)) return null;
  // Every take being a departure is the mirror failure: nothing would be on brief.
  if (a.positions.every(p => p.departure) && b.positions.every(p => p.departure)) return null;
  return { a, b };
}

export interface PlanInput {
  intent: Intent;
  proposedAxes?: unknown;
  perImageUsd: number;
}

/** The whole plan, model-proposed axes where valid and the fallback otherwise. */
export function buildExplorePlan(input: PlanInput): ExplorePlan {
  const proposed = input.proposedAxes === undefined ? null : validateAxes(input.proposedAxes);
  const axes = proposed ?? FALLBACK_AXES[input.intent];
  const takes = buildExploreGrid(axes);
  return {
    axes,
    takes,
    costCents: spreadCostCents(input.perImageUsd, takes.length),
    offBriefCount: takes.filter(t => t.offBrief !== null).length,
    fallback: proposed === null,
  };
}
