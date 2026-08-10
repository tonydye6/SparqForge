/**
 * The Smart Bar: a proactive collaborator, driven by a stage event stream.
 *
 * Spec: the approved mock (artifact 6056f09f, screen 4) and Tony's framing —
 * "breaking the fourth wall of collaboration": an instance that brings things
 * to the table because the work itself woke it, not because somebody typed at
 * it. The mechanism decision, agreed 2026-08-10: the trigger is a STAGE EVENT
 * STREAM derived from rows the product already writes, never screenshots.
 * Events are cheaper than vision, fire on state transitions rather than a
 * clock, and every input is a row the user can inspect (§1.17).
 *
 * V1 IS DELIBERATELY DETERMINISTIC. Every card below derives from data the
 * product already computed, so the bar ships with value that costs nothing
 * per glance and is never wrong about a fact. The card contract is the part
 * built to outlive v1: a model-backed rule later emits the same shape.
 *
 * THE CONTRACT EVERY CARD KEEPS:
 *   - `saw` names the event that woke it. A suggestion with no citation is
 *     an opinion; a citation is what makes it a colleague pointing at the
 *     board.
 *   - one action, executable or navigational, never a lecture.
 *   - pink is reserved for the one card class where the work is at risk
 *     (subject fidelity, doc 24 §4: "a beautiful Studio that generates the
 *     wrong person is a failed Studio").
 *
 * Pure, and runnable under tsx like the other services carrying invariants.
 */

import type { Intent } from "../lib/intents.js";
import { buildExplorePlan } from "./explore-plan.js";

// ── inputs ───────────────────────────────────────────────────────────────────

export interface BarTake {
  stageKind: string;
  slotKey: string;
  origin: string;
  isCurrent: boolean;
  createdAt: string;
  payload: unknown;
}

export interface BarStage {
  stageKind: string;
  status: string;
  updatedAt: string;
}

export interface BarInput {
  stages: BarStage[];
  takes: BarTake[];
  /** The brief's goal, null when none was recorded. */
  intent: Intent | null;
  /** How many takes one spread renders, from settings. */
  spreadSize: number;
  directorName: string | null;
}

// ── outputs ──────────────────────────────────────────────────────────────────

export interface BarEvent {
  at: string;
  /** Machine key, so a client can filter without string-matching prose. */
  kind:
    | "brief_saved"
    | "direction_chosen"
    | "spread_rendered"
    | "take_picked"
    | "copy_saved"
    | "crops_saved";
  /** One mono line for the "what it saw" feed. */
  line: string;
}

export interface BarCard {
  id: string;
  /** The event that woke this card, cited on the card itself. */
  saw: string;
  tone: "risk" | "note";
  text: string;
  action:
    | { type: "open_stage"; stageKind: string; label: string }
    | { type: "href"; href: string; label: string }
    | null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const clock = (iso: string) => iso.slice(11, 16);

function current(takes: readonly BarTake[], stageKind: string, slotKey: string): BarTake | null {
  return takes.find((t) => t.stageKind === stageKind && t.slotKey === slotKey && t.isCurrent) ?? null;
}

interface MaterialFacts {
  catalogSize: number | null;
  subjectCount: number | null;
  subjectPinned: boolean;
}

/**
 * What the director actually reached for, read off the SAME take payload the
 * Material rail renders — one source, so the bar can never disagree with the
 * rail about the fact both report. `directorSelections` roles are the honest
 * count; `material.subjectCount` is deliberately not read, for the rail's own
 * documented reason (imagen lanes miscount a logo as a subject).
 *
 * `subjectPin` is read alongside, because a director that was HANDED the
 * subject selects zero of its own on purpose: an `@` mention (or the pin
 * inherited from the previous run) enters the references as an attachment,
 * above the director's picks, and the director is explicitly told not to
 * choose a second subject. Counting only `directorSelections` here fired the
 * pink card on exactly the sessions doing subject fidelity RIGHT — vc-cr-9's
 * brief mentioned the character by name and still got accused.
 */
function materialFactsOf(take: BarTake | null): MaterialFacts {
  const p = take?.payload as
    | { material?: { catalogSize?: unknown; directorSelections?: unknown; subjectPin?: unknown } }
    | null
    | undefined;
  const m = p?.material;
  if (!m || typeof m !== "object") return { catalogSize: null, subjectCount: null, subjectPinned: false };
  const selections = Array.isArray(m.directorSelections)
    ? (m.directorSelections as Array<{ role?: unknown }>)
    : null;
  return {
    catalogSize: typeof m.catalogSize === "number" ? m.catalogSize : null,
    subjectCount: selections ? selections.filter((s) => s.role === "subject").length : null,
    subjectPinned: Boolean(m.subjectPin && typeof m.subjectPin === "object"),
  };
}

// ── the stream ───────────────────────────────────────────────────────────────

export function deriveEvents(input: BarInput): BarEvent[] {
  const events: BarEvent[] = [];
  const { takes } = input;

  const brief = current(takes, "brief", "brief");
  if (brief) {
    const words = String((brief.payload as { line?: unknown })?.line ?? "").trim().split(/\s+/).filter(Boolean).length;
    events.push({ at: brief.createdAt, kind: "brief_saved", line: `brief saved · ${words} words` });
  }

  const direction = current(takes, "direction", "direction");
  if (direction) {
    const name = String((direction.payload as { name?: unknown })?.name ?? "a director");
    events.push({ at: direction.createdAt, kind: "direction_chosen", line: `director ${name}` });
  }

  const rendered = takes.filter((t) => t.stageKind === "asset" && t.origin === "generated" && t.slotKey !== "selected");
  if (rendered.length > 0) {
    const latest = rendered.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    events.push({
      at: latest.createdAt,
      kind: "spread_rendered",
      line: `spread rendered · ${rendered.length} ${rendered.length === 1 ? "take" : "takes"} so far`,
    });
  }

  const picked = current(takes, "asset", "selected");
  if (picked) {
    const slot = String((picked.payload as { slotKey?: unknown })?.slotKey ?? "");
    events.push({ at: picked.createdAt, kind: "take_picked", line: `take picked · ${slot.replace("__", " / ") || "one of the spread"}` });
  }

  const copy = current(takes, "copy", "copy");
  if (copy) events.push({ at: copy.createdAt, kind: "copy_saved", line: "copy saved" });

  const crops = current(takes, "crops", "crops");
  if (crops) events.push({ at: crops.createdAt, kind: "crops_saved", line: "framing set" });

  return events.sort((a, b) => a.at.localeCompare(b.at)).map((e) => ({ ...e, line: `${clock(e.at)} ${e.line}` }));
}

// ── the cards ────────────────────────────────────────────────────────────────

export function deriveCards(input: BarInput): BarCard[] {
  const cards: BarCard[] = [];
  const { takes, intent } = input;

  const brief = current(takes, "brief", "brief");
  const rendered = takes.filter((t) => t.stageKind === "asset" && t.origin === "generated" && t.slotKey !== "selected");
  const picked = current(takes, "asset", "selected");

  /*
   * 1 · Subject fidelity, the pink one.
   *
   * Doc 24 §1's original complaint, still the highest-value fact the product
   * knows: the director reached for no subject reference, so the character
   * will not look like the character. The rail reports it quietly; this says
   * it while a re-run is still cheap.
   */
  const latestRendered = rendered.length
    ? rendered.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
    : null;
  const material = materialFactsOf(latestRendered);
  if (material.subjectCount === 0 && !material.subjectPinned && (material.catalogSize ?? 0) > 0) {
    cards.push({
      id: "no-subject-reference",
      saw: "spread rendered · material",
      tone: "risk",
      text: `The director reached for 0 subject references out of ${material.catalogSize}. The character will not stay the character without one.`,
      action: { type: "href", href: "/assets", label: "Open the library" },
    });
  }

  /*
   * 2 · Departures paid for twice and never chosen.
   *
   * NOT a per-spread card. Every full spread renders its departures BY
   * DESIGN, so "N takes went past the brief" after one run is the plan's
   * shape, not a signal — a card there would fire on every healthy session,
   * which is how a bar teaches people to stop reading it (my own quiet-
   * session test caught the first version doing exactly that). The signal is
   * the SECOND spend: a re-roll whose departure half has still never been
   * picked means half of every roll is going to takes that are not earning
   * looks, and a narrower run buys a full spread of the half that is.
   */
  if (rendered.length > 0) {
    const plan = buildExplorePlan({ intent: intent ?? "awareness", perImageUsd: 0, spreadSize: input.spreadSize });
    const departureKeys = new Set(plan.takes.filter((t) => t.offBrief !== null).map((t) => t.id));
    const pickedSlot = String((picked?.payload as { slotKey?: unknown })?.slotKey ?? "");
    const rerolled = rendered.length >= plan.takes.length * 2;

    if (rerolled && picked && !departureKeys.has(pickedSlot) && departureKeys.size > 0) {
      cards.push({
        id: "off-brief-bulk",
        saw: `re-roll · ${departureKeys.size} of ${plan.takes.length} past the brief, none ever picked`,
        tone: "note",
        text: `Both runs spent ${departureKeys.size} takes on deliberate departures and you have chosen on-brief both times. A run on narrower axes buys ${plan.takes.length} takes of the half you pick from.`,
        action: { type: "open_stage", stageKind: "asset", label: "Open the spread" },
      });
    }

    /*
     * 3 · The second roll with nothing chosen at all. Two spreads is a taste
     * signal in itself: the axes are wrong, or the choice is hard. Either way
     * a third identical roll is the most expensive way to find out.
     */
    if (rerolled && !picked) {
      cards.push({
        id: "second-spread-no-pick",
        saw: `spread rendered · ${rendered.length} takes, none picked`,
        tone: "note",
        text: "Two spreads and nothing chosen. Refine on the closest take costs one image; a third identical roll costs another spread.",
        action: { type: "open_stage", stageKind: "asset", label: "Open the spread" },
      });
    }
  }

  /*
   * 4 · The default axes. The spread plans against the goal, and a brief with
   * no goal recorded gets the fallback pair. Said here BEFORE money is spent
   * on axes that were never chosen for this post.
   */
  if (brief && intent === null && !latestRendered) {
    cards.push({
      id: "no-goal",
      saw: "brief saved · no goal recorded",
      tone: "note",
      text: "The brief has no goal recorded, so the spread will plan on default axes rather than ones chosen for this post.",
      action: { type: "open_stage", stageKind: "brief", label: "Open the brief" },
    });
  }

  // Risk before notes, then newest concern first by list order above.
  return cards.sort((a, b) => Number(b.tone === "risk") - Number(a.tone === "risk"));
}
