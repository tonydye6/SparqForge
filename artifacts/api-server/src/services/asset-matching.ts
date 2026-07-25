import { db, assetsTable } from "@workspace/db";
import type { Asset } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import {
  checkGenerationEligibility,
  computeRankingAdjustment,
  buildConflictTagSet,
  type GenerationContext,
} from "./asset-policy.js";

export type MatchRole = "image_reference" | "text_description" | "compositing" | "context";

export interface AssetMatch {
  asset: Asset;
  score: number;
  role: MatchRole;
  matchedTerms: string[];
}

export interface ExcludedAsset {
  asset: Asset;
  reason: string;
  matchedTerms: string[];
}

export interface MatchResult {
  imageReferences: AssetMatch[];
  textDescriptions: AssetMatch[];
  compositing: AssetMatch[];
  context: AssetMatch[];
  /** Assets that matched the brief but were filtered by policy hard constraints. */
  excluded: ExcludedAsset[];
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for",
  "with", "by", "from", "up", "about", "into", "over", "after", "is", "are",
  "was", "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "should", "could", "may", "might", "must", "can",
  "this", "that", "these", "those", "it", "its", "we", "our", "you", "your",
  "as", "if", "so", "not", "no", "new", "make", "create", "post", "image",
  "photo", "picture", "show", "showing", "featuring", "using", "use",
]);

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s#@-]/g, " ")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

function stem(token: string): string {
  return token.replace(/(ing|ers|er|ies|es|s)$/, "");
}

function assetSearchText(asset: Asset): string {
  return [
    asset.name,
    asset.description || "",
    (asset.tags || []).join(" "),
    (asset.depictedEntities || []).join(" "),
    asset.styleNotes || "",
    asset.characterIdentityNote || "",
    asset.franchise || "",
    asset.content || "",
  ].join(" ");
}

/**
 * Tokenize a brief into the token+stem set scoreAssetAgainstBrief expects.
 * Exported for the Co-pilot creative director's asset catalog, which ranks
 * the whole library with the same scoring as this module's matcher.
 */
export function buildBriefTokenSet(briefText: string): Set<string> {
  const raw = tokenize(briefText);
  return new Set<string>([...raw, ...raw.map(stem)]);
}

export function scoreAssetAgainstBrief(asset: Asset, briefTokens: Set<string>): { score: number; matchedTerms: string[] } {
  const matched = new Set<string>();
  let score = 0;

  const weightedFields: Array<{ text: string; weight: number }> = [
    { text: (asset.depictedEntities || []).join(" "), weight: 3 },
    { text: (asset.tags || []).join(" "), weight: 2.5 },
    { text: asset.name, weight: 2 },
    { text: asset.characterIdentityNote || "", weight: 2 },
    { text: asset.description || "", weight: 1.5 },
    { text: asset.styleNotes || "", weight: 1 },
    { text: asset.franchise || "", weight: 1.5 },
    { text: asset.content || "", weight: 1 },
  ];

  for (const { text, weight } of weightedFields) {
    const tokens = tokenize(text);
    for (const token of tokens) {
      const s = stem(token);
      if (briefTokens.has(token) || briefTokens.has(s)) {
        if (!matched.has(s)) {
          matched.add(s);
          score += weight;
        } else {
          score += weight * 0.2;
        }
      }
    }
  }

  // Mild quality boosts so ties break toward curated assets.
  if (asset.status === "approved") score += 0.5;
  if (asset.aiAnalyzedAt) score += 0.25;
  score += Math.min(asset.usageCount || 0, 5) * 0.1;

  // Apply soft policy ranking adjustments (subjectIdentityScore,
  // styleStrengthScore, freshnessScore, referencePriorityDefault, brandLayer).
  score += computeRankingAdjustment(asset);

  return { score, matchedTerms: [...matched] };
}

export async function matchAssetsToBrief(params: {
  brandId: string;
  briefText: string;
  maxImageRefs?: number;
  maxTextDescriptors?: number;
  context?: GenerationContext;
}): Promise<MatchResult> {
  const { brandId, briefText } = params;
  const maxImageRefs = params.maxImageRefs ?? 3;
  const maxTextDescriptors = params.maxTextDescriptors ?? 3;
  const context = params.context ?? {};

  const rawTokens = tokenize(briefText);
  const briefTokens = new Set<string>([...rawTokens, ...rawTokens.map(stem)]);

  const assets = await db.select().from(assetsTable).where(and(
    eq(assetsTable.brandId, brandId),
    ne(assetsTable.status, "archived"),
  ));

  const scored: Array<{ asset: Asset; score: number; matchedTerms: string[] }> = [];
  for (const asset of assets) {
    const { score, matchedTerms } = scoreAssetAgainstBrief(asset, briefTokens);
    if (matchedTerms.length === 0) continue;
    scored.push({ asset, score, matchedTerms });
  }
  scored.sort((a, b) => b.score - a.score);

  const compositing: AssetMatch[] = [];
  const context_results: AssetMatch[] = [];
  const generationEligible: AssetMatch[] = [];
  const excluded: ExcludedAsset[] = [];

  // Build conflict-tag set from assets already committed (empty for the
  // initial match — callers with multi-round selection pass it in context).
  const conflictTagsInUse = context.conflictTagsInUse ?? new Set<string>();

  // Track conflict tags accumulated as we walk in rank order so that
  // within a single match run, conflicting assets are excluded transitively.
  const accumulatedConflictTags = new Set<string>(conflictTagsInUse);

  for (const { asset: a, score, matchedTerms } of scored) {
    // Compositing-class assets (logos, overlays) — always route to the
    // compositing bucket regardless of generationAllowed.
    if (a.assetClass === "compositing" || a.compositingOnly) {
      const policyResult = checkGenerationEligibility(a, context, "compositing");
      if (!policyResult.eligible) {
        excluded.push({ asset: a, reason: policyResult.reason, matchedTerms });
        continue;
      }
      if (compositing.length < 2) compositing.push({ asset: a, score, role: "compositing", matchedTerms });
      continue;
    }

    // Context-class assets.
    if (a.type === "context" || a.assetClass === "context") {
      if (context_results.length < 3) context_results.push({ asset: a, score, role: "context", matchedTerms });
      continue;
    }

    // Only visuals reach generation reference slots.
    if (a.type !== "visual") continue;
    if (!a.fileUrl || (a.mimeType || "").includes("video")) continue;

    // Apply policy hard constraints (generation_reference role).
    const contextWithAccumulated: GenerationContext = {
      ...context,
      conflictTagsInUse: accumulatedConflictTags,
    };
    const policyResult = checkGenerationEligibility(a, contextWithAccumulated, "generation_reference");
    if (!policyResult.eligible) {
      excluded.push({ asset: a, reason: policyResult.reason, matchedTerms });
      continue;
    }

    // Asset passed all constraints — accumulate its conflict tags.
    for (const t of (a.conflictTags as string[] | null | undefined) ?? []) {
      accumulatedConflictTags.add(t);
    }

    generationEligible.push({ asset: a, score, role: "text_description", matchedTerms });
  }

  const imageReferences = generationEligible
    .slice(0, maxImageRefs)
    .map(m => ({ ...m, role: "image_reference" as MatchRole }));
  const textDescriptions = generationEligible
    .slice(maxImageRefs, maxImageRefs + maxTextDescriptors)
    .filter(m => !!(m.asset.description || m.asset.styleNotes))
    .map(m => ({ ...m, role: "text_description" as MatchRole }));

  return { imageReferences, textDescriptions, compositing, context: context_results, excluded };
}
