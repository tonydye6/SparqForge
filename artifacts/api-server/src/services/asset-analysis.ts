import { ai } from "@workspace/integrations-gemini-ai";
import { AI_MODELS, estimateGeminiTextCost } from "../lib/ai-config.js";
import { buildCostRow } from "./cost-recording.js";
import { db, assetsTable, costLogsTable } from "@workspace/db";
import type { Asset } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { resolveUrl, readBuffer } from "./storage.js";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export interface AssetAnalysisResult {
  description: string;
  kind: string;
  entities: string[];
  tags: string[];
  colors: string[];
  styleNotes: string;
  characterIdentityNote: string;
  brandLayer: string | null;
  subjectIdentityScore: number | null;
  styleStrengthScore: number | null;
  freshnessScore: number | null;
  generationAllowed: boolean;
  conflictTagHints: string[];
}

const KIND_TO_CLASS: Record<string, { assetClass: string; generationRole: string }> = {
  logo: { assetClass: "compositing", generationRole: "overlay" },
  character: { assetClass: "subject_reference", generationRole: "primary_subject" },
  mascot: { assetClass: "subject_reference", generationRole: "primary_subject" },
  person: { assetClass: "subject_reference", generationRole: "primary_subject" },
  product: { assetClass: "subject_reference", generationRole: "primary_subject" },
  scene: { assetClass: "style_reference", generationRole: "background" },
  background: { assetClass: "style_reference", generationRole: "background" },
  texture: { assetClass: "style_reference", generationRole: "background" },
  graphic: { assetClass: "style_reference", generationRole: "supporting" },
};

const INTELLIGENCE_FIELDS = [
  "assetClass",
  "generationRole",
  "brandLayer",
  "compositingOnly",
  "generationAllowed",
  "subjectIdentityScore",
  "styleStrengthScore",
  "freshnessScore",
  "conflictTags",
] as const;

type IntelligenceField = typeof INTELLIGENCE_FIELDS[number];

function buildPrompt(asset: Asset): string {
  return `You are an asset librarian for a sports marketing content platform.

Analyze the provided image (asset filename: "${asset.name}"). Return a JSON object with exactly these fields:

- "description": 1-2 sentences describing exactly what the image shows (subjects, setting, action, notable details). Be concrete and specific.
- "kind": one of "logo", "character", "mascot", "person", "product", "scene", "background", "texture", "graphic", "other"
- "entities": array of named or describable entities depicted (e.g. ["Rex the mascot", "football", "Crown U jersey #7"]). Empty array if none.
- "tags": array of 3-8 short lowercase search tags (e.g. ["football", "night game", "celebration"])
- "colors": array of 2-5 dominant colors as simple names or hex (e.g. ["navy blue", "#F5A623", "white"])
- "styleNotes": one sentence on visual style (e.g. "high-contrast dramatic stadium photography with cool tones")
- "characterIdentityNote": if kind is character/mascot/person, one sentence identifying who this is with distinguishing features for identity-consistent AI generation; otherwise empty string.
- "brandLayer": if the image is a logo or brand mark, one of "primary_logo", "secondary_mark", "watermark", "partner"; otherwise null.
- "subjectIdentityScore": integer 1-5 rating how clearly and fully the subject is depicted for AI identity reference (5=very clear full-body or close-up, high quality; 1=barely visible or heavily obscured). Only meaningful for character/mascot/person/product kinds — return null for logos, scenes, backgrounds, or textures.
- "styleStrengthScore": integer 1-5 rating how distinctive and strong the visual style is (5=very distinctive recognizable style; 1=generic/bland). Most meaningful for scene/background/texture/graphic kinds — return null for logos.
- "freshnessScore": integer 1-5 rating how modern and high-production the asset feels (5=very polished and contemporary; 1=dated or very low quality).
- "generationAllowed": boolean, true in almost all cases. Set false only if the image clearly contains a competitor brand's trademark/logo, external celebrity likeness without apparent authorization, or other content that should not be used for AI generation.
- "conflictTagHints": array of 0-3 short strings suggesting potential conflict categories only when you have strong visual evidence (e.g. ["competitor_logo"] if a rival brand mark is clearly visible). Usually return empty array [].

Return ONLY valid JSON, no markdown code blocks or extra text.`;
}

export async function analyzeAssetImage(asset: Asset): Promise<AssetAnalysisResult> {
  if (!asset.fileUrl) throw new Error("Asset has no file to analyze");
  const loc = resolveUrl(asset.fileUrl);
  if (!loc) throw new Error("Asset file location could not be resolved");
  const buffer = await readBuffer(loc);
  if (!buffer) throw new Error("Asset file could not be read from storage");
  if (buffer.length > MAX_FILE_SIZE_BYTES) throw new Error("Asset file exceeds 10MB analysis limit");

  const mimeType = asset.mimeType && asset.mimeType.startsWith("image/") ? asset.mimeType : "image/png";

  const response = await ai.models.generateContent({
    model: AI_MODELS.GEMINI_FLASH_TEXT,
    contents: [
      {
        role: "user",
        parts: [
          { text: buildPrompt(asset) },
          { inlineData: { data: buffer.toString("base64"), mimeType } },
        ],
      },
    ],
  });

  const text = response.candidates?.[0]?.content?.parts
    ?.filter((part: { text?: string }) => part.text)
    .map((part: { text?: string }) => part.text)
    .join("") || "";

  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse asset analysis response: ${cleaned.slice(0, 200)}`);
  }

  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map(s => s.trim()).filter(Boolean) : [];

  const toNullableInt = (v: unknown, min = 1, max = 5): number | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? Math.round(v) : parseInt(String(v), 10);
    if (isNaN(n)) return null;
    return Math.max(min, Math.min(max, n));
  };

  const VALID_BRAND_LAYERS = ["primary_logo", "secondary_mark", "watermark", "partner"];
  const brandLayerRaw = typeof parsed.brandLayer === "string" ? parsed.brandLayer : null;

  return {
    description: typeof parsed.description === "string" ? parsed.description : "",
    kind: typeof parsed.kind === "string" ? parsed.kind.toLowerCase() : "other",
    entities: toStringArray(parsed.entities),
    tags: toStringArray(parsed.tags).map(t => t.toLowerCase()),
    colors: toStringArray(parsed.colors),
    styleNotes: typeof parsed.styleNotes === "string" ? parsed.styleNotes : "",
    characterIdentityNote: typeof parsed.characterIdentityNote === "string" ? parsed.characterIdentityNote : "",
    brandLayer: brandLayerRaw && VALID_BRAND_LAYERS.includes(brandLayerRaw) ? brandLayerRaw : null,
    subjectIdentityScore: toNullableInt(parsed.subjectIdentityScore),
    styleStrengthScore: toNullableInt(parsed.styleStrengthScore),
    freshnessScore: toNullableInt(parsed.freshnessScore),
    generationAllowed: parsed.generationAllowed === false ? false : true,
    conflictTagHints: toStringArray(parsed.conflictTagHints),
  };
}

export function isAnalyzableAsset(asset: Asset): boolean {
  return asset.type === "visual"
    && !!asset.fileUrl
    && !(asset.mimeType || "").includes("video");
}

export async function analyzeAndStoreAsset(assetId: string): Promise<Asset> {
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, assetId));
  if (!asset) throw new Error("Asset not found");
  if (!isAnalyzableAsset(asset)) throw new Error("Asset is not an analyzable image");

  const analysis = await analyzeAssetImage(asset);

  const currentAiFields = new Set<string>(asset.aiSuggestedFields || []);

  // Overwrite rule for non-boolean intelligence fields:
  //   • Field is in aiSuggestedFields  → AI set it last time, not yet user-confirmed → refresh it
  //   • Field is genuinely unset (null / empty string / empty array) → AI can populate for first time
  //   • Anything else → user has a real value (pre-analysis manual entry or confirmed save) → skip
  // NOTE: booleans use setIntelligenceBool below because null/undefined can't be the proxy for
  //   "never set" (Postgres fills in the column default before we can see it).
  const canOverwrite = (fieldName: IntelligenceField, currentValue: unknown): boolean => {
    if (currentAiFields.has(fieldName)) return true;
    if (currentValue === null || currentValue === undefined || currentValue === "") return true;
    if (Array.isArray(currentValue) && currentValue.length === 0) return true;
    return false;
  };

  const newAiSuggestedFields = new Set<string>(currentAiFields);

  const mergedTags = [...new Set([...(asset.tags || []), ...analysis.tags])];
  const updates: Record<string, unknown> = {
    description: analysis.description || asset.description,
    tags: mergedTags,
    depictedEntities: analysis.entities,
    colors: analysis.colors,
    styleNotes: analysis.styleNotes || null,
    aiAnalyzedAt: new Date(),
    updatedAt: new Date(),
  };

  // Standard helper: skip null/undefined/empty-array AI values; respect canOverwrite.
  const setIntelligenceField = (
    fieldName: IntelligenceField,
    currentValue: unknown,
    newValue: unknown,
  ) => {
    if (newValue === null || newValue === undefined) return;
    if (Array.isArray(newValue) && newValue.length === 0) return;
    if (canOverwrite(fieldName, currentValue)) {
      updates[fieldName] = newValue;
      newAiSuggestedFields.add(fieldName);
    }
  };

  // Boolean helper: booleans always have a Postgres default so we can't use "is null" to detect
  // "never set".  Rules:
  //   1. Field already AI-suggested → always refresh (allows flipping back to true, etc.)
  //   2. AI wants to set a NON-default value AND current value equals the schema default
  //      → field is almost certainly at its DB-initialised default, not user-confirmed → set it.
  //   3. Otherwise (user confirmed a non-default value, or AI just reaffirms an already-default
  //      value with no provenance) → skip.
  const setIntelligenceBool = (
    fieldName: IntelligenceField,
    currentValue: boolean | null | undefined,
    newValue: boolean,
    schemaDefault: boolean,
  ) => {
    if (currentAiFields.has(fieldName)) {
      updates[fieldName] = newValue;
      newAiSuggestedFields.add(fieldName);
    } else if (
      newValue !== schemaDefault &&
      (currentValue === schemaDefault || currentValue === null || currentValue === undefined)
    ) {
      updates[fieldName] = newValue;
      newAiSuggestedFields.add(fieldName);
    }
  };

  // Clearable array helper: when the field is AI-suggested, refresh even to [] (AI "cleared" its
  // own suggestion); otherwise behave like setIntelligenceField.
  const setIntelligenceArrayClearable = (
    fieldName: IntelligenceField,
    currentValue: unknown,
    newValue: unknown[],
  ) => {
    if (currentAiFields.has(fieldName)) {
      updates[fieldName] = newValue;
      if (newValue.length > 0) {
        newAiSuggestedFields.add(fieldName);
      } else {
        newAiSuggestedFields.delete(fieldName);
      }
    } else if (newValue.length > 0 && canOverwrite(fieldName, currentValue)) {
      updates[fieldName] = newValue;
      newAiSuggestedFields.add(fieldName);
    }
  };

  const mapping = KIND_TO_CLASS[analysis.kind];
  if (mapping) {
    setIntelligenceField("assetClass", asset.assetClass, mapping.assetClass);
    setIntelligenceField("generationRole", asset.generationRole, mapping.generationRole);
    if (mapping.assetClass === "compositing") {
      setIntelligenceBool("compositingOnly", asset.compositingOnly, true, false);
      if (!asset.approvedForCompositing) updates.approvedForCompositing = true;
    }
  }

  if (analysis.brandLayer) {
    setIntelligenceField("brandLayer", asset.brandLayer, analysis.brandLayer);
  }

  if (analysis.subjectIdentityScore !== null) {
    setIntelligenceField("subjectIdentityScore", asset.subjectIdentityScore, analysis.subjectIdentityScore / 5);
  }

  if (analysis.styleStrengthScore !== null) {
    setIntelligenceField("styleStrengthScore", asset.styleStrengthScore, analysis.styleStrengthScore / 5);
  }

  if (analysis.freshnessScore !== null) {
    setIntelligenceField("freshnessScore", asset.freshnessScore, analysis.freshnessScore / 5);
  }

  // Always pass generationAllowed (true or false) so re-analysis can refresh an AI-suggested
  // false back to true when content is later deemed safe.
  setIntelligenceBool("generationAllowed", asset.generationAllowed, analysis.generationAllowed, true);

  // Use clearable helper so existing AI-suggested conflict tags are cleared when AI finds none.
  setIntelligenceArrayClearable("conflictTags", asset.conflictTags, analysis.conflictTagHints);

  if (analysis.characterIdentityNote && !asset.characterIdentityNote) {
    updates.characterIdentityNote = analysis.characterIdentityNote;
  }

  updates.aiSuggestedFields = Array.from(newAiSuggestedFields);

  const [updated] = await db
    .update(assetsTable)
    .set(updates)
    .where(eq(assetsTable.id, assetId))
    .returning();

  try {
    await db.insert(costLogsTable).values(buildCostRow({
      brandId: updated?.brandId ?? null,
      service: "gemini",
      operation: "asset_analysis",
      model: AI_MODELS.GEMINI_FLASH_TEXT,
      costUsd: estimateGeminiTextCost(),
    }));
  } catch (err) {
    console.error("Failed to log asset analysis cost:", err instanceof Error ? err.message : err);
  }

  return updated;
}

export interface BackfillAnalysisResult {
  scanned: number;
  analyzed: number;
  failed: number;
  skipped: number;
  errors: Array<{ assetId: string; name: string; error: string }>;
}

export async function backfillAssetAnalysis(options?: {
  brandId?: string;
  force?: boolean;
  limit?: number;
}): Promise<BackfillAnalysisResult> {
  const conditions = [eq(assetsTable.type, "visual")];
  if (options?.brandId) conditions.push(eq(assetsTable.brandId, options.brandId));
  if (!options?.force) conditions.push(isNull(assetsTable.aiAnalyzedAt));

  let candidates = await db.select().from(assetsTable).where(and(...conditions));
  candidates = candidates.filter(isAnalyzableAsset);
  if (options?.limit && options.limit > 0) candidates = candidates.slice(0, options.limit);

  const result: BackfillAnalysisResult = {
    scanned: candidates.length,
    analyzed: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const CONCURRENCY = 3;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (asset) => {
      try {
        await analyzeAndStoreAsset(asset.id);
        result.analyzed++;
      } catch (err) {
        result.failed++;
        result.errors.push({
          assetId: asset.id,
          name: asset.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }));
  }

  return result;
}

export function analyzeAssetInBackground(assetId: string): void {
  void analyzeAndStoreAsset(assetId)
    .then(() => console.log(`[asset-analysis] auto-analyzed asset ${assetId}`))
    .catch((err) =>
      console.warn(`[asset-analysis] auto-analysis failed for ${assetId}: ${err instanceof Error ? err.message : err}`),
    );
}
