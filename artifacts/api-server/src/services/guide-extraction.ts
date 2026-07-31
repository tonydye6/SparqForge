/**
 * Phase 5 · reading a brand guide into the record.
 *
 * The point is cold start. A brand nobody has filled in generates from scaffold
 * defaults, and the fastest way to warm it is the PDF the brand team already
 * wrote. But an extraction that writes straight into the record would be exactly
 * the failure §1.17 exists to prevent: an automated suggestion quietly becoming
 * brand law.
 *
 * So this produces CANDIDATES, never values. Three rules make them trustworthy:
 *
 *  1. **Every candidate carries a quote.** The model must point at the sentence
 *     it read the value from. A candidate with no evidence is dropped, which is
 *     the cheapest anti-invention device available and also what makes
 *     "confirming extracted lines" a real act rather than a rubber stamp.
 *  2. **Nothing is offered that the document does not state.** Absence is a
 *     valid answer, and a guide that says nothing about sound should produce no
 *     sound candidate rather than a plausible one.
 *  3. **A candidate that would replace something a person wrote is flagged.**
 *     Overwriting an authored field silently is worse than not extracting at all.
 *
 * Pure: no DB, no clock, no model call. The route does the I/O.
 */

import { BRAND_FIELDS, parseFieldValue, formatFieldValue, type FieldSource, type FieldSpec } from "./brand-completeness.js";

/** Fields a written brand guide plausibly contains. */
const EXTRACTABLE = new Set([
  "colorPrimary", "colorSecondary", "colorAccent", "colorBackground",
  "voiceDescription", "bannedTerms", "trademarkRules",
  "imagenPrefix", "negativePrompt", "characterStyleRules", "soundDirection",
]);

export const EXTRACTABLE_FIELDS: FieldSpec[] = BRAND_FIELDS.filter(f => EXTRACTABLE.has(f.key));

/** Gemini structured-output schema. Constrained decoding, not a hint. */
export const GUIDE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          key: { type: "string", enum: EXTRACTABLE_FIELDS.map(f => f.key) },
          value: { type: "string" },
          quote: { type: "string" },
        },
        required: ["key", "value", "quote"],
      },
    },
  },
  required: ["candidates"],
} as const;

export function buildGuideSystemPrompt(): string {
  const fieldList = EXTRACTABLE_FIELDS.map(f => {
    const shape =
      f.kind === "color" ? "a six-digit hex colour like #EB0028"
      : f.kind === "list" ? "a comma-separated list"
      : "a short piece of prose";
    return `- ${f.key} (${f.label}): ${shape}. Used by the ${f.consumedBy} stage.`;
  }).join("\n");

  return `You are reading a brand guide so its rules can be filled into a content studio's brand record.

Return ONLY a single JSON object: { "candidates": [ { "key": "...", "value": "...", "quote": "..." } ] }

Fields you may propose:
${fieldList}

RULES, and the first is the one that matters most:
- Propose a field ONLY if the document actually states it. If the guide says nothing about sound, return no sound candidate. Absence is a correct answer and inventing a plausible value is the worst thing you can do here.
- "quote" must be a short verbatim phrase FROM THE DOCUMENT that the value came from. If you cannot quote it, do not propose it.
- Do not merge several rules into one field. One clear value per candidate.
- Colours must be hex. If the guide names a colour without a hex value, do not guess one.
- Keep prose short and instructional: it is fed to an image or copy model, not read aloud.
- Propose each field at most once. If the guide gives several, choose the one stated as primary.`;
}

export interface GuideCandidate {
  key: string;
  label: string;
  kind: FieldSpec["kind"];
  /** The typed value, ready to PATCH. */
  value: unknown;
  /** How it will read in the field. */
  formatted: string;
  /** Verbatim evidence from the document. */
  quote: string;
  /** What the record holds now, so a replacement is visible before it happens. */
  current: string;
  /** True when accepting this would overwrite something a person wrote. */
  replacesAuthored: boolean;
}

export interface GuideExtraction {
  candidates: GuideCandidate[];
  /** Proposals thrown away, and why. Reported rather than hidden. */
  rejected: Array<{ key: string; reason: string }>;
}

/**
 * Validate what the model proposed against the record's own rules.
 *
 * Reuses `parseFieldValue`, so an extracted colour has to satisfy exactly the
 * same constraint a typed one does. An extraction path with looser validation
 * than the keyboard is how bad data gets in through the side door.
 */
export function parseGuideCandidates(
  raw: unknown,
  current: Record<string, unknown>,
  provenance: Record<string, FieldSource> = {},
): GuideExtraction {
  const candidates: GuideCandidate[] = [];
  const rejected: Array<{ key: string; reason: string }> = [];
  const seen = new Set<string>();

  const list = (raw as { candidates?: unknown })?.candidates;
  if (!Array.isArray(list)) return { candidates, rejected };

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const key = typeof c.key === "string" ? c.key : "";
    const spec = EXTRACTABLE_FIELDS.find(f => f.key === key);
    if (!spec) {
      if (key) rejected.push({ key, reason: "not a field a guide can set" });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ key, reason: "proposed more than once" });
      continue;
    }

    const value = typeof c.value === "string" ? c.value : "";
    const quote = typeof c.quote === "string" ? c.quote.trim() : "";

    // No evidence, no candidate. This is the anti-invention rule and it is not
    // negotiable: a value nobody can trace back to the document is a guess
    // wearing the guide's authority.
    if (!quote) {
      rejected.push({ key, reason: "no quote from the document" });
      continue;
    }
    if (!value.trim()) {
      rejected.push({ key, reason: "empty value" });
      continue;
    }

    const parsed = parseFieldValue(spec, value);
    if (!parsed.ok) {
      rejected.push({ key, reason: parsed.error });
      continue;
    }

    seen.add(key);
    candidates.push({
      key,
      label: spec.label,
      kind: spec.kind,
      value: parsed.value,
      formatted: formatFieldValue(spec, parsed.value),
      quote,
      current: formatFieldValue(spec, current[key]),
      replacesAuthored: provenance[key] === "user" && formatFieldValue(spec, current[key]).trim() !== "",
    });
  }

  return { candidates, rejected };
}
