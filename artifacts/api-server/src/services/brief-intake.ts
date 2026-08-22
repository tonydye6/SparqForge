/**
 * Stage 01 · Brief · the derivation behind the "What I derived from that" panel.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.11, §1.12, §1.17.
 *
 * Everything here answers one question: when someone types six words, what does
 * the model actually receive, and who decided each part of it? Four rules from
 * the spec are enforced in code rather than left to the prompt:
 *
 *   1. ONE LINE IS ALWAYS ENOUGH. Nothing in this module can fail in a way that
 *      blocks saving a brief. The route returns rows or it returns fewer rows.
 *   2. THE TYPED LINE IS NEVER REWRITTEN. No function here reads or returns it.
 *   3. EVERY QUESTION CARRIES THE ASSUMPTION IT FALLS BACK TO. A question with
 *      no stated default is a gate, and gates make people abandon briefs, so
 *      `normalizeQuestions` DROPS any question the model returned without one.
 *      That rule cannot be softened by a prompt regression.
 *   4. EVERY ROW IS LABELLED WITH ITS SOURCE. `provenance` is required, not
 *      optional, so an unlabelled row cannot be constructed.
 *
 * Splitting the deterministic derivation (this file) from the model call (the
 * route) is deliberate: vitest cannot start on the author's Mac, so the parts
 * that carry the invariants are pure and runnable under `pnpm exec tsx`.
 */

import { INTENT_DESCRIPTIONS, INTENT_LABELS, type Intent } from "../lib/intents.js";

/** Who decided a line. Rendered as a badge on every derived row, per §1.17. */
export type Provenance = "you" | "inferred" | "brand";

export interface DerivedRow {
  key: string;
  label: string;
  value: string;
  provenance: Provenance;
  /** Optional honesty note, e.g. a low confidence or the runner-up intent. */
  note?: string;
}

export interface OpenQuestion {
  id: string;
  question: string;
  options: string[];
  /** Never optional. See rule 3 above. */
  assumption: string;
}

/**
 * Who the post is talking to, derived from the strategic goal.
 *
 * Deterministic rather than model-generated, for two reasons: the mapping is
 * genuinely a property of the intent taxonomy rather than of this brief, and a
 * second inference would be a second thing to be wrong about at no benefit. It
 * is still labelled "inferred" because it was derived, not authored.
 */
export const INTENT_AUDIENCES: Record<Intent, string> = {
  awareness: "People who have not heard of the brand yet",
  acquisition: "Interested non-players, close to trying it",
  community_engagement: "Existing players, not new installs",
  recognition_reward: "The specific players and creators being celebrated",
  announcement_launch: "Existing followers first, wider reach second",
  education: "Players who already play and want to play better",
  retention: "Lapsed and drifting players who used to be active",
};

/** Human labels for the publishable platforms. */
export const PLATFORM_LABELS: Record<string, string> = {
  instagram: "IG",
  instagram_feed: "IG feed",
  instagram_story: "IG Story",
  twitter: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

/** The strategic goal row. */
export function deriveGoal(
  intent: Intent,
  confidence: number,
  runnerUp?: { intent: Intent; confidence: number } | null,
): DerivedRow {
  // Strip the taxonomy's trailing period so it reads as a row, not a sentence.
  const value = INTENT_DESCRIPTIONS[intent].replace(/\.$/, "");
  // Surfacing a weak call is the point. A confident wrong guess presented as
  // fact is worse than a hedged one, because only the hedge invites a correction.
  const note =
    confidence < 0.7
      ? runnerUp
        ? `${Math.round(confidence * 100)}% sure · next best is ${INTENT_LABELS[runnerUp.intent]}`
        : `${Math.round(confidence * 100)}% sure`
      : undefined;
  return { key: "goal", label: "Goal", value, provenance: "inferred", ...(note ? { note } : {}) };
}

export function deriveAudience(intent: Intent): DerivedRow {
  return {
    key: "audience",
    label: "Audience",
    value: INTENT_AUDIENCES[intent],
    provenance: "inferred",
    note: `from the goal, not from your line`,
  };
}

/**
 * Where it can actually go: the platforms this workspace has a connected
 * account for. Reading real accounts rather than listing every platform the product
 * supports means the row cannot promise a channel that would fail at publish.
 */
export function deriveChannels(connectedPlatforms: string[]): DerivedRow {
  const unique = [...new Set(connectedPlatforms)];
  if (unique.length === 0) {
    return {
      key: "channels",
      label: "Channels",
      value: "No channel is connected for this workspace yet, so nothing can publish",
      provenance: "brand",
      note: "connect one in Settings",
    };
  }
  const order = ["instagram", "twitter", "tiktok", "youtube", "linkedin"];
  const sorted = [...unique].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  });
  return {
    key: "channels",
    label: "Channels",
    value: sorted.map(platformLabel).join(", "),
    provenance: "brand",
  };
}

export interface BrandConstraints {
  bannedTerms?: string[] | null;
  negativePrompt?: string | null;
  trademarkRules?: string | null;
}

/**
 * The hard constraints, read off the brand record.
 *
 * Returns null when the brand records none. An empty "Must not" row would imply
 * the brand has no rules, which is a different and misleading claim from having
 * nothing to show.
 */
export function deriveMustNot(brand: BrandConstraints): DerivedRow | null {
  const parts: string[] = [];

  const banned = (brand.bannedTerms ?? []).map(t => t.trim()).filter(Boolean);
  if (banned.length > 0) {
    // Cap the list so one over-full brand record cannot push the real
    // constraints off the panel. The count keeps the omission honest.
    const shown = banned.slice(0, 4);
    const rest = banned.length - shown.length;
    parts.push(`never say ${shown.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}`);
  }

  const negative = (brand.negativePrompt ?? "").trim();
  if (negative) parts.push(negative.replace(/\.$/, ""));

  const trademark = (brand.trademarkRules ?? "").trim();
  if (trademark) parts.push(trademark.replace(/\.$/, ""));

  if (parts.length === 0) return null;

  const value = parts.join(" · ");
  return {
    key: "mustnot",
    label: "Must not",
    value: value.length > 220 ? `${value.slice(0, 217)}...` : value,
    provenance: "brand",
  };
}

export interface DerivationInput {
  intent: Intent;
  confidence: number;
  runnerUp?: { intent: Intent; confidence: number } | null;
  connectedPlatforms: string[];
  brand: BrandConstraints;
}

/** The full ordered panel: what the model will receive, and who decided it. */
export function buildDerivedRows(input: DerivationInput): DerivedRow[] {
  const rows: DerivedRow[] = [
    deriveGoal(input.intent, input.confidence, input.runnerUp ?? null),
    deriveAudience(input.intent),
    deriveChannels(input.connectedPlatforms),
  ];
  const mustNot = deriveMustNot(input.brand);
  if (mustNot) rows.push(mustNot);
  return rows;
}

/* ------------------------------------------------------------------------- *
 * The story path · step 4a · the shot list.
 *
 * Tony's race example broke the take-pool framing (doc 42): a spread is
 * variations of ONE moment, and a story is DIFFERENT moments. So a brief that
 * narrates gets a SHOT LIST — one row per moment, derived here and editable
 * before anything is generated or paid for.
 *
 * The rules mirror the questions' rules above, deliberately:
 *
 *   1. A SHOT IS A MOMENT, NOT A COMPOSITION. Two shots that describe the same
 *      instant are a spread, and the spread already exists.
 *   2. ONE SHOT IS NOT A STORY. Below two moments there is nothing to sequence,
 *      so the sequence is not suggested — the brief is one picture.
 *   3. MALFORMED ROWS ARE DROPPED, NEVER REPAIRED. Inventing the text of a shot
 *      would attribute a moment to the brief that nobody wrote, and the user is
 *      about to pay per beat.
 *   4. THE SUGGESTION IS NEVER THE DECISION. This returns whether the brief
 *      reads as a story; the person chooses. A derived shot list on a post
 *      somebody wanted as one picture costs nothing, because nothing runs until
 *      they say so.
 * ------------------------------------------------------------------------- */

export interface Shot {
  /** 1-based, assigned here so no caller can produce a shot 0. */
  n: number;
  /** The moment, in the brief's own terms. */
  text: string;
  /** Who wrote this row. An edited row is the user's. */
  provenance: Provenance;
}

/**
 * Hard ceiling on shots.
 *
 * Six is already ~$0.50 of preview takes plus six clips before a word of copy;
 * past that this is a film rather than a post, and the honest place to say so
 * is the cap rather than an invoice.
 */
export const MAX_SHOTS = 6;

/** Below this a brief is one moment, however it is phrased. See rule 2. */
export const MIN_SHOTS_FOR_STORY = 2;

/** How long one shot's description may be before it stops being a shot. */
const MAX_SHOT_CHARS = 180;

/**
 * Normalise whatever the model returned into shots, or into nothing.
 *
 * Deduplicated case-insensitively: a model asked for moments will sometimes
 * return the same beat twice in different words, and paying twice to generate
 * one moment is exactly the failure the shot list exists to prevent.
 */
export function normalizeShots(raw: unknown): Shot[] {
  if (!Array.isArray(raw)) return [];
  const out: Shot[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const text =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string"
          ? (item as { text: string }).text.trim()
          : "";
    if (!text) continue;

    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    out.push({
      n: out.length + 1,
      text: text.length > MAX_SHOT_CHARS ? `${text.slice(0, MAX_SHOT_CHARS - 3)}...` : text,
      provenance: "inferred",
    });
    if (out.length === MAX_SHOTS) break;
  }

  return out;
}

/** Does this brief read as a story? A suggestion, never a decision. */
export function readsAsStory(shots: readonly Shot[]): boolean {
  return shots.length >= MIN_SHOTS_FOR_STORY;
}

/**
 * Renumber after an edit, a delete or a reorder.
 *
 * Positions are the whole ordering model here, exactly as they are for sequence
 * clips, so a list is never allowed to carry a gap or a duplicate: "beat 2"
 * has to mean one thing, and the slot families the storyboard generates from
 * (`beat1__a`…) are named off these numbers.
 */
export function renumberShots(shots: readonly Shot[]): Shot[] {
  return shots
    .filter(s => s.text.trim().length > 0)
    .slice(0, MAX_SHOTS)
    .map((s, i) => ({ ...s, n: i + 1 }));
}

/** Hard ceiling on questions. Past this it stops being an interview. */
export const MAX_QUESTIONS = 3;

/**
 * Enforce rule 3 on whatever the model returned.
 *
 * A question missing its assumption is dropped rather than repaired, because
 * inventing a default here would attribute an assumption to the system that
 * nothing actually decided. Dropping loses a question; faking one loses trust
 * in every label on the screen.
 */
export function normalizeQuestions(raw: unknown): OpenQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: OpenQuestion[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;

    const question = typeof q.question === "string" ? q.question.trim() : "";
    const assumption = typeof q.assumption === "string" ? q.assumption.trim() : "";
    if (!question || !assumption) continue;

    const options = Array.isArray(q.options)
      ? [...new Set(q.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map(o => o.trim()))].slice(0, 4)
      : [];
    // A question with fewer than two choices is not a question.
    if (options.length < 2) continue;

    const id = typeof q.id === "string" && q.id.trim() ? q.id.trim() : `q${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({ id, question, options, assumption });
    if (out.length === MAX_QUESTIONS) break;
  }

  return out;
}
