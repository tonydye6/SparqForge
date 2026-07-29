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
 * Where it can actually go: the platforms this brand has a connected account
 * for. Reading real accounts rather than listing every platform the product
 * supports means the row cannot promise a channel that would fail at publish.
 */
export function deriveChannels(connectedPlatforms: string[]): DerivedRow {
  const unique = [...new Set(connectedPlatforms)];
  if (unique.length === 0) {
    return {
      key: "channels",
      label: "Channels",
      value: "No channel is connected for this brand yet, so nothing can publish",
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
