/**
 * Asset Intelligence Policy
 *
 * Single source of truth for how Asset Details fields affect generation
 * eligibility and ranking. Both the asset matcher and the Creative Director
 * catalogue builder import from here so the two paths can never drift.
 *
 * ── Hard constraints (enforced before any model call) ─────────────────────
 *
 *  generationAllowed === false
 *    The asset owner explicitly blocked AI reference use.
 *    → Never include as a generation reference.
 *
 *  compositingOnly === true  (or assetClass === "compositing")
 *    The asset is a logo / brand mark intended only for post-compositing.
 *    → Never include as a subject / style / context generation reference.
 *      (Compositing slots are still valid; pass role="compositing".)
 *
 *  approvedChannels non-empty and target channel absent
 *    The asset owner scoped the asset to specific distribution channels.
 *    → Exclude when the generation context targets a different channel.
 *
 *  approvedTemplates non-empty and target template absent
 *    The asset is approved only for particular creative templates.
 *    → Exclude when the generation context uses a different template.
 *
 *  conflictTags overlap with conflictTagsInUse
 *    Two assets with shared conflict tags would produce brand or character
 *    collisions in the same generation (e.g. competing mascots).
 *    → Exclude when any of the asset's conflict tags appear in the
 *      set of tags already claimed by other selected assets.
 *
 * ── Soft signals (ranking adjustments, not gates) ─────────────────────────
 *
 *  referencePriorityDefault (1–5)
 *    Explicit brand-team preference for how often to use this asset.
 *    5 = always prefer, 1 = rarely use. Contributes up to ±1.5 to score.
 *
 *  subjectIdentityScore (1–5)
 *    How strongly the asset conveys its subject identity (face, character,
 *    mascot recognition). Higher = better as a subject/character reference.
 *    Contributes up to +1.5 to score.
 *
 *  styleStrengthScore (1–5)
 *    How strongly the asset communicates a style or mood. Higher = better
 *    as a style reference. Contributes up to +1.0 to score.
 *
 *  freshnessScore (1–5)
 *    Recency / current relevance. A stale asset (1) gets a mild penalty;
 *    a fresh asset (5) gets a mild boost. Contributes up to ±0.5.
 *
 *  brandLayer ("core" | "campaign" | "seasonal" | ...)
 *    Core brand assets get a small universal boost because they should
 *    appear consistently across content. Contributes +0.3 for "core".
 *
 *  status === "approved"  /  aiAnalyzedAt set  /  usageCount
 *    These are already factored in scoreAssetAgainstBrief; the policy
 *    does not double-count them.
 */

import type { Asset } from "@workspace/db";

// ── Context ─────────────────────────────────────────────────────────────────

/**
 * Context passed by callers so the policy can apply channel- and template-
 * gating as well as conflict-tag checks.
 *
 * All fields are optional: when absent the corresponding constraint is not
 * applied (a missing channel does not exclude channel-gated assets; the
 * matcher operates on the full library and lets the caller decide relevance).
 */
export interface GenerationContext {
  /** Distribution channel, e.g. "instagram_feed", "twitter", "linkedin". */
  channel?: string | null;
  /** Creative template slug, e.g. "product-launch". */
  template?: string | null;
  /**
   * Union of all conflictTags contributed by assets already committed to
   * this generation set. Used to detect mascot / brand collisions.
   */
  conflictTagsInUse?: Set<string>;
}

// ── Eligibility ──────────────────────────────────────────────────────────────

export interface EligibilityResult {
  eligible: true;
  reason?: never;
}
export interface IneligibilityResult {
  eligible: false;
  /** Human-readable label shown in the Studio UI asset picker. */
  reason: string;
}
export type PolicyResult = EligibilityResult | IneligibilityResult;

/**
 * Check all hard constraints for a generation reference slot.
 *
 * Returns `{ eligible: false, reason }` on the first failing constraint
 * (constraints are checked in the documented priority order).
 * Returns `{ eligible: true }` when all pass.
 *
 * The `role` parameter controls which constraints are applied:
 *   - "generation_reference"  (default) — subject/style/object image refs
 *   - "compositing"           — post-compositing overlay (logo, mask)
 *
 * For compositing role: only `generationAllowed` and conflict tags apply;
 * `compositingOnly` is NOT a constraint (it's the intended use).
 */
export function checkGenerationEligibility(
  asset: Pick<
    Asset,
    | "generationAllowed"
    | "compositingOnly"
    | "assetClass"
    | "approvedChannels"
    | "approvedTemplates"
    | "conflictTags"
  >,
  context: GenerationContext = {},
  role: "generation_reference" | "compositing" = "generation_reference",
): PolicyResult {
  // 1. generationAllowed=false — hard stop for all roles.
  if (asset.generationAllowed === false) {
    return { eligible: false, reason: "Not approved for AI generation" };
  }

  // 2. compositingOnly — only applies when the slot is a generation reference
  //    (not a compositing slot where it's the correct use).
  if (role === "generation_reference") {
    if (asset.compositingOnly || asset.assetClass === "compositing") {
      return { eligible: false, reason: "Compositing-only asset (use logo overlay instead)" };
    }
  }

  // 3. Channel gating — only when a target channel is specified.
  const { channel, template, conflictTagsInUse } = context;
  if (channel) {
    const approved = asset.approvedChannels as string[] | null | undefined;
    if (approved && approved.length > 0 && !approved.includes(channel)) {
      return { eligible: false, reason: `Not approved for ${channel} channel` };
    }
  }

  // 4. Template gating — only when a target template is specified.
  if (template) {
    const approved = asset.approvedTemplates as string[] | null | undefined;
    if (approved && approved.length > 0 && !approved.includes(template)) {
      return { eligible: false, reason: "Not approved for this template" };
    }
  }

  // 5. Conflict tags — only when other assets have already claimed tags.
  if (conflictTagsInUse && conflictTagsInUse.size > 0) {
    const tags = asset.conflictTags as string[] | null | undefined;
    if (tags && tags.length > 0) {
      const clash = tags.find(t => conflictTagsInUse.has(t));
      if (clash) {
        return { eligible: false, reason: "Conflicts with another selected asset" };
      }
    }
  }

  return { eligible: true };
}

// ── Ranking adjustments ──────────────────────────────────────────────────────

/**
 * Compute a soft ranking delta to add on top of the text-match score.
 *
 * All signals are bounded so a single field can't dominate; the total range
 * is roughly −0.5 to +3.0 (deliberately less than a strong text match).
 */
export function computeRankingAdjustment(
  asset: Pick<
    Asset,
    | "referencePriorityDefault"
    | "subjectIdentityScore"
    | "styleStrengthScore"
    | "freshnessScore"
    | "brandLayer"
  >,
): number {
  let delta = 0;

  // referencePriorityDefault: 1–5 → maps to −0.75 … +1.5
  if (asset.referencePriorityDefault != null) {
    delta += (asset.referencePriorityDefault - 3) * 0.375;
  }

  // subjectIdentityScore: 1–5 → 0 … +1.5
  if (asset.subjectIdentityScore != null) {
    delta += ((asset.subjectIdentityScore - 1) / 4) * 1.5;
  }

  // styleStrengthScore: 1–5 → 0 … +1.0
  if (asset.styleStrengthScore != null) {
    delta += ((asset.styleStrengthScore - 1) / 4) * 1.0;
  }

  // freshnessScore: 1–5 → −0.25 … +0.5
  if (asset.freshnessScore != null) {
    delta += (asset.freshnessScore - 3) * 0.125;
  }

  // brandLayer: core assets get a flat boost.
  if (asset.brandLayer === "core") {
    delta += 0.3;
  }

  return delta;
}

// ── Conflict-tag union helper ────────────────────────────────────────────────

/**
 * Build the conflict-tag set for a collection of already-committed assets.
 * Pass the result as `conflictTagsInUse` in GenerationContext.
 */
export function buildConflictTagSet(assets: Pick<Asset, "conflictTags">[]): Set<string> {
  const s = new Set<string>();
  for (const a of assets) {
    for (const t of (a.conflictTags as string[] | null | undefined) ?? []) {
      s.add(t);
    }
  }
  return s;
}

// ── Role derivation helper ────────────────────────────────────────────────────

/**
 * Derive the policy role from a stored asset's classification fields.
 * Used to pick the right eligibility path when iterating a mixed library.
 */
export function derivePolicyRole(
  asset: Pick<Asset, "compositingOnly" | "assetClass">,
): "generation_reference" | "compositing" {
  if (asset.compositingOnly || asset.assetClass === "compositing") return "compositing";
  return "generation_reference";
}

// ── Slot description enrichment ──────────────────────────────────────────────

/**
 * Append intelligence metadata to a slot description string so the model
 * gets richer context about the asset's intended use.
 *
 * Called by the Creative Director when constructing slot descriptions for
 * assets that do reach the model.
 */
export function enrichSlotDescription(
  base: string,
  asset: Pick<
    Asset,
    | "assetClass"
    | "generationRole"
    | "brandLayer"
    | "franchise"
    | "characterIdentityNote"
  >,
): string {
  const hints: string[] = [];
  if (asset.brandLayer === "core") hints.push("core brand asset");
  if (asset.brandLayer === "campaign") hints.push("campaign asset");
  if (asset.generationRole) hints.push(`generation role: ${asset.generationRole}`);
  if (asset.franchise) hints.push(`franchise: ${asset.franchise}`);
  if (!hints.length) return base;
  return `${base} [${hints.join("; ")}]`;
}
