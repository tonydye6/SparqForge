/**
 * Phase 5 · the brand record as a compounding asset.
 *
 * Leaving these fields in Settings was the biggest structural mistake in the
 * effort, because everything leans on them and nothing showed you what was
 * missing. A live session made the cost concrete: Crown U turned out to have no
 * default style profile, no locked director, and two of its own logos invisible
 * to the Creative Director, and none of that was visible anywhere.
 *
 * So completeness is not a progress bar. **An incomplete brand is not broken; it
 * is guessing, and this says what it is guessing and what that costs.** Each
 * field below names the stage that consumes it and the sentence a user should
 * read when it is empty.
 *
 * The second rule is provenance. A field written by PDF extraction, by
 * harvesting the asset library, or by a performance conclusion is marked as
 * such, so an automated suggestion can never quietly become brand law (§1.17).
 *
 * No DB, no clock, no randomness.
 */

/*
 * Who decided a field. Re-exported from the schema rather than redeclared,
 * because it WAS redeclared and the two definitions disagreed: this file said
 * "learned" and the column said "performance", and the route's cast hid it from
 * tsc. Type-only, so nothing at runtime imports the database.
 */
export type { FieldSource } from "@workspace/db";
import type { FieldSource } from "@workspace/db";

/**
 * What a screen shows, which is the persisted set plus one computed state.
 *
 * `"default"` is not a provenance and is never stored. It means "no value", and
 * it is derived from the value being empty, so a field that is cleared cannot
 * go on claiming that a person chose it.
 */
export type FieldDisplaySource = FieldSource | "default";

export const SOURCE_LABEL: Record<FieldDisplaySource, string> = {
  user: "You",
  guide: "From the guide",
  learned: "Learned",
  default: "Never set",
};

/**
 * How a field is stored, which decides how it is shown and how a typed edit is
 * turned back into a value.
 *
 * Not cosmetic. `bannedTerms` is a text[] and `hashtagStrategy` is jsonb, so a
 * screen that edits everything as a string will push a string into an array
 * column the first time someone changes one.
 */
export type FieldKind = "text" | "color" | "list" | "json";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  /** Which stage reads it, so the cost is traceable rather than abstract. */
  consumedBy: string;
  /** Its share of the score. Not all fields are worth the same. */
  weight: number;
  /** What happens when it is empty, in plain words. */
  costWhenMissing: string;
  /**
   * The scaffold default, where one exists. A field still sitting at its
   * scaffold value is NOT filled in, however non-empty it looks: this project
   * has already been bitten by reading a default as a decision.
   */
  scaffoldDefault?: string;
}

/**
 * Weights reflect what a still-image studio actually consumes today. Sound and
 * narration matter, but they steer a Motion stage that has not shipped, so they
 * cannot outweigh the character rules that every single generation reads.
 */
export const BRAND_FIELDS: FieldSpec[] = [
  {
    key: "characterStyleRules", kind: "text", label: "Character and style rules", consumedBy: "Image",
    weight: 12,
    costWhenMissing: "Nothing tells the model to hold a character's exact appearance, so it invents a lookalike instead of using yours.",
  },
  {
    key: "colorPrimary", kind: "color", label: "Primary colour", consumedBy: "Image, Copy",
    weight: 8, scaffoldDefault: "#3B82F6",
    costWhenMissing: "The palette sent to the model is the scaffold blue, which appears nowhere in your brand.",
  },
  {
    key: "colorSecondary", kind: "color", label: "Secondary colour", consumedBy: "Image",
    weight: 5, scaffoldDefault: "#1E3A5F",
    costWhenMissing: "Only one brand colour reaches the model, so it picks its own supporting tones.",
  },
  {
    key: "colorAccent", kind: "color", label: "Accent colour", consumedBy: "Image",
    weight: 5, scaffoldDefault: "#60A5FA",
    costWhenMissing: "There is no accent to place, so highlights land wherever the model decides.",
  },
  {
    key: "colorBackground", kind: "color", label: "Background colour", consumedBy: "Image",
    weight: 4, scaffoldDefault: "#0A0A0F",
    costWhenMissing: "Grounds and environments are chosen by the model rather than by you.",
  },
  {
    key: "imagenPrefix", kind: "text", label: "Visual language", consumedBy: "Image",
    weight: 10,
    costWhenMissing: "The director gets colours but no sense of how this brand looks, so every post starts from a generic house style.",
  },
  {
    key: "negativePrompt", kind: "text", label: "Never include", consumedBy: "Image",
    weight: 8,
    costWhenMissing: "Nothing is ruled out, so the things you keep rejecting keep coming back.",
  },
  {
    key: "voiceDescription", kind: "text", label: "Voice", consumedBy: "Copy",
    weight: 10,
    costWhenMissing: "Captions are written in a general social voice rather than yours.",
  },
  {
    key: "bannedTerms", kind: "list", label: "Banned terms", consumedBy: "Copy",
    weight: 6,
    costWhenMissing: "The voice check has nothing to check against, so it can only catch shouting and stray hashtags.",
  },
  {
    key: "trademarkRules", kind: "text", label: "Trademark rules", consumedBy: "Copy",
    weight: 5,
    costWhenMissing: "Marks and naming conventions are not enforced in copy.",
  },
  {
    key: "logoFileUrl", kind: "text", label: "Logo", consumedBy: "Image",
    weight: 7,
    costWhenMissing: "There is no canonical mark to composite or reference, so the director has to find one in the library.",
  },
  {
    key: "defaultPersonaId", kind: "text", label: "Default director", consumedBy: "Direction",
    weight: 6,
    costWhenMissing: "Every post starts with no director chosen, so stage 02 ranks personas from scratch each time.",
  },
  {
    key: "hashtagStrategy", kind: "json", label: "Hashtag strategy", consumedBy: "Copy",
    weight: 5,
    costWhenMissing: "Hashtags are invented per post rather than drawn from a set you maintain.",
  },
  {
    key: "soundDirection", kind: "text", label: "Sound direction", consumedBy: "Motion",
    weight: 4,
    costWhenMissing: "Music and effects have no brand steer. Only matters once you make video.",
  },
  {
    key: "narratorVoiceId", kind: "text", label: "Narrator", consumedBy: "Motion",
    weight: 5,
    costWhenMissing: "There is no voice for narration. Only matters once you make video.",
  },
];

export const TOTAL_WEIGHT = BRAND_FIELDS.reduce((n, f) => n + f.weight, 0);

/**
 * Is a field genuinely filled in?
 *
 * A value still sitting at its scaffold default counts as EMPTY, and that
 * distinction is the whole point. `colorPrimary` ships as `#3B82F6`, a blue that
 * appears nowhere in the Sparq brand; treating it as "set" would score a brand
 * as configured while it feeds the model a colour nobody chose. The same
 * reasoning already cost this project a day over `approvedForCompositing`.
 */
export function isFilled(spec: FieldSpec, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  const s = String(value).trim();
  if (!s) return false;
  if (spec.scaffoldDefault && s.toLowerCase() === spec.scaffoldDefault.toLowerCase()) return false;
  return true;
}

export interface FieldState {
  spec: FieldSpec;
  filled: boolean;
  source: FieldDisplaySource;
}

export interface BrandCompleteness {
  /** 0-100, weighted. */
  score: number;
  fields: FieldState[];
  /** Filled fields, for a headline count. */
  filledCount: number;
  /** What is missing, worst-cost first, so the next action is obvious. */
  missing: FieldState[];
  /** True when nothing at all has been set. */
  cold: boolean;
}

export function scoreBrand(
  record: Record<string, unknown>,
  provenance: Record<string, FieldSource> = {},
): BrandCompleteness {
  const fields: FieldState[] = BRAND_FIELDS.map((spec) => {
    const filled = isFilled(spec, record[spec.key]);
    /*
     * A field that is not filled is "default" whatever the provenance map says.
     * Stale provenance from a value that was later cleared would otherwise claim
     * a human decided something that is no longer there.
     */
    const source: FieldDisplaySource = filled ? (provenance[spec.key] ?? "user") : "default";
    return { spec, filled, source };
  });

  const earned = fields.filter(f => f.filled).reduce((n, f) => n + f.spec.weight, 0);
  const missing = fields
    .filter(f => !f.filled)
    .sort((a, b) => b.spec.weight - a.spec.weight);

  return {
    score: Math.round((earned / TOTAL_WEIGHT) * 100),
    fields,
    filledCount: fields.length - missing.length,
    missing,
    cold: earned === 0,
  };
}

/**
 * One sentence for the top of the screen.
 *
 * Never scolds and never says "incomplete". A brand at 24% is not broken, it is
 * guessing more, and the honest framing is what it costs rather than what it
 * lacks.
 */
export function completenessSummary(c: BrandCompleteness): string {
  if (c.cold) {
    return "Nothing is set yet, so every post is generated from the scaffold defaults. Anything you fill in below is used immediately.";
  }
  if (c.missing.length === 0) {
    return "Everything the Studio reads is set. Nothing is being guessed.";
  }
  const worst = c.missing[0]!;
  return `${c.filledCount} of ${c.fields.length} set. The biggest gap is ${worst.spec.label.toLowerCase()}: ${worst.spec.costWhenMissing}`;
}

/**
 * Candidate palette colours harvested from the brand's own asset library.
 *
 * The library already carries analysed `colors` per asset, so the brand's real
 * palette is sitting in it unread. Suggestions only: they arrive as candidates a
 * human confirms, and confirming is what stamps provenance. Harvesting straight
 * into the record would be the automation-becomes-brand-law failure §1.17 exists
 * to prevent.
 */
/** How a stored value is shown in an editable field. */
export function formatFieldValue(spec: FieldSpec, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (spec.kind === "list") return Array.isArray(value) ? value.join(", ") : String(value);
  /*
   * JSON is shown as JSON rather than as "[object Object]", which is what the
   * first version rendered. A field the user cannot read is a field they cannot
   * correct.
   */
  if (spec.kind === "json") return typeof value === "object" ? JSON.stringify(value) : String(value);
  return String(value);
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Turn what someone typed back into the shape the column expects.
 *
 * Refuses rather than coerces. Sending a string to a text[] column or a bare
 * string to jsonb is how a record gets quietly corrupted, and "it saved" is the
 * worst possible feedback for a write that destroyed the value.
 */
export function parseFieldValue(spec: FieldSpec, text: string): ParseResult {
  const trimmed = text.trim();

  if (spec.kind === "list") {
    const items = trimmed
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    return { ok: true, value: items };
  }

  if (spec.kind === "json") {
    if (!trimmed) return { ok: true, value: {} };
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { ok: false, error: "This field holds a JSON object, so it needs braces: {\"always_include\": [\"#CrownU\"]}" };
      }
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, error: "That is not valid JSON, so nothing was saved." };
    }
  }

  if (spec.kind === "color") {
    if (!trimmed) return { ok: true, value: "" };
    if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return { ok: false, error: "A colour needs to be a six-digit hex value like #EB0028." };
    }
    return { ok: true, value: trimmed };
  }

  return { ok: true, value: trimmed };
}

export function harvestColors(assetColors: string[][], limit = 6): Array<{ color: string; count: number }> {
  const counts = new Map<string, number>();
  for (const list of assetColors) {
    // Count each colour once per asset, or one heavily-tagged asset decides the palette.
    const seen = new Set<string>();
    for (const raw of list) {
      const c = String(raw || "").trim().toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(c)) continue;
      if (seen.has(c)) continue;
      seen.add(c);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color))
    .slice(0, limit);
}
