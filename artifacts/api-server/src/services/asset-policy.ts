/**
 * Asset Intelligence Policy
 *
 * Single source of truth for how Asset Details fields affect generation
 * eligibility and ranking. Both the asset matcher and the Creative Director
 * catalogue builder import from here so the two paths can never drift.
 *
 * ── Hard constraints (enforced before any model call) ─────────────────────
 *
 *  generationAllowed === false        [generation_reference role ONLY]
 *    The asset owner explicitly blocked AI reference use.
 *    → Never include as a generation reference.
 *    NOT applied to the compositing role: every logo is stored with
 *      generationAllowed=false by brand seeding (routes/brands.ts), the
 *      backfill service, and AI analysis, so for a mark the flag carries no
 *      human intent — it just means "not a generic generation reference".
 *      Gating the compositing role on it made every logo permanently
 *      ineligible, which is the bug this ordering fixes.
 *
 *  compositingOnly === true  (or assetClass === "compositing")
 *    The asset is a logo / brand mark intended only for post-compositing.
 *    → Never include as a subject / style / context generation reference.
 *      (Compositing slots are still valid; pass role="compositing".)
 *
 *  approvedForCompositing === false   [compositing role, managed rows]
 *    A human turned off mark usage in Asset Details. Applied when the row is
 *    managed (assetClass === "compositing"), because every path that sets that
 *    class also writes approvedForCompositing=true — so `false` there is a
 *    deliberate opt-out. NOT applied to hand-toggled compositingOnly rows that
 *    were never classified, where the column is merely at its schema default
 *    (false) and blocking would make the asset unusable in every role.
 *
 * ── Note on the two pipelines ─────────────────────────────────────────────
 *
 * The legacy StudioNext path never renders logos: it strips logo mentions from
 * the prompt (services/logo-intent.ts) and composites the real mark on after
 * generation. The Co-pilot Studio path deliberately diverges — Nano Banana Pro
 * reproduces a supplied mark faithfully, so an attached or director-selected
 * logo is passed in as an exact in-image reference and there is no compositing
 * step. Both behaviors are intentional; do not "unify" them without deciding
 * which pipeline owns logo placement.
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
import { mentionsBrandMark } from "./logo-intent.js";

/** The asset columns every policy check reads. */
export type PolicyAsset = Pick<
  Asset,
  | "generationAllowed"
  | "compositingOnly"
  | "assetClass"
  | "approvedForCompositing"
  | "approvedChannels"
  | "approvedTemplates"
  | "conflictTags"
  // M3 · trademark remediation state. See `trademarkGate` below.
  | "trademarkScanState"
  | "trademarkReviewedAt"
>;

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
 * Trademark remediation gate. **Fails closed on purpose.**
 *
 * This exists because of a specific, verified hole. The August remediation
 * produced 28 retouched replacements and left every one of them
 * `generationAllowed = true` at status `uploaded` — reachable by the Director
 * while nobody had checked them. Reviewing them found a replacement whose
 * Nike swoosh had come off but whose Big Ten mark had NOT, and several whose
 * SPARQ wordmark the retouch had corrupted to "SPARR" / "SPARO".
 *
 * So a `replacement` is ineligible until a human sets `trademarkReviewedAt`.
 * The asymmetry is deliberate: an unreviewed replacement wrongly blocked costs
 * somebody a click, while one wrongly allowed puts a third-party mark into
 * generated output and into anything published from it.
 *
 * `null` state means never scanned, and is NOT blocked — most of the library is
 * in that state, and failing closed on it would take the whole library offline.
 * Absence of evidence is treated as absence of evidence, not as a finding.
 */
export function trademarkGate(
  asset: Pick<Asset, "trademarkScanState" | "trademarkReviewedAt">,
): PolicyResult {
  switch (asset.trademarkScanState) {
    case "blocked":
      return { eligible: false, reason: "Carries a third-party trademark" };
    case "refused":
      return {
        eligible: false,
        reason: "Trademark removal was attempted and did not succeed",
      };
    case "retouched":
      // The ORIGINAL of a successful retouch. A clean replacement exists and is
      // what should be used, so the contaminated source stays out.
      return { eligible: false, reason: "Superseded by a retouched copy" };
    case "replacement":
      return asset.trademarkReviewedAt
        ? { eligible: true }
        : { eligible: false, reason: "Retouched copy is awaiting trademark review" };
    case "review":
      // A mark IS present; the open question is only whether a licence already
      // covers it. That is the same shape of uncertainty as an unreviewed
      // replacement, so it gets the same asymmetry: closed until a human with
      // the licence terms sets `trademarkReviewedAt`.
      return asset.trademarkReviewedAt
        ? { eligible: true }
        : { eligible: false, reason: "Carries a mark a licence may cover — awaiting review" };
    case "clean":
    default:
      return { eligible: true };
  }
}

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
 * For the compositing role, `generationAllowed` and `compositingOnly` are NOT
 * constraints (they describe the intended use); `approvedForCompositing` is the
 * human opt-out. See the header for why.
 */
export function checkGenerationEligibility(
  asset: PolicyAsset,
  context: GenerationContext = {},
  role: "generation_reference" | "compositing" = "generation_reference",
): PolicyResult {
  // 0. Trademark state, BEFORE every other constraint and for BOTH roles.
  //    A third-party mark is not a use-intent question — it is the one class of
  //    defect that is expensive after the fact, so it gates the logo path too.
  const tm = trademarkGate(asset);
  if (!tm.eligible) return tm;

  if (role === "generation_reference") {
    // 1. generationAllowed=false — the owner blocked AI reference use.
    if (asset.generationAllowed === false) {
      return { eligible: false, reason: "Not approved for AI generation" };
    }
    // 2. Compositing-class assets are not generic generation references.
    if (asset.compositingOnly || asset.assetClass === "compositing") {
      return { eligible: false, reason: "Compositing-only asset (use logo overlay instead)" };
    }
  } else {
    // Compositing role. generationAllowed is deliberately not consulted (it is
    // false on every seeded/analyzed logo). A managed compositing row whose
    // approvedForCompositing was turned off is a human opt-out; the reason text
    // names the control so the block is actionable rather than mysterious.
    if (asset.assetClass === "compositing" && asset.approvedForCompositing === false) {
      return {
        eligible: false,
        reason: "Not approved for logo use (enable Approved for compositing in Asset Details)",
      };
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

/**
 * Eligibility for a Co-pilot turn attachment (the 📎 picker or an instruction
 * name match), where the asset becomes an in-image reference slot.
 *
 * Role is derived from the asset, so an attached logo is judged as a mark
 * (verbatim in-image reference) rather than being rejected as a generic
 * generation reference.
 *
 * `source` distinguishes intent:
 *   - "explicit"   — the user picked this asset. Marks are allowed.
 *   - "auto_match" — the asset's name merely appeared in the instruction text.
 *                    Marks additionally require the instruction to talk about a
 *                    logo/mark, so a logo named after the brand is not baked
 *                    into every instruction that mentions the brand.
 */
export function checkAttachmentEligibility(
  asset: PolicyAsset,
  context: GenerationContext,
  source: "explicit" | "auto_match",
  instruction: string,
): PolicyResult {
  const role = derivePolicyRole(asset);
  if (role === "compositing" && source === "auto_match" && !mentionsBrandMark(instruction)) {
    return {
      eligible: false,
      reason: "Brand mark not attached: pick it explicitly or mention the logo",
    };
  }
  return checkGenerationEligibility(asset, context, role);
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
