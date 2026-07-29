import { pgTable, text, boolean, timestamp, json, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { designerPersonasTable } from "./designer-personas";

/**
 * One applied composition rule.
 *
 * Every rule carries the sample size it was learned from, because a rule drawn
 * from four posts and a rule drawn from four hundred must not look alike on a
 * brand record that generation reads as law.
 */
export interface CompositionRule {
  rule: string;
  source: "user" | "guide" | "performance";
  n: number;
  confidence: number;
  appliedAt: string;
}

/** Where a brand field's current value came from. Principle 1.17. */
export type FieldSource = "user" | "guide" | "performance";

export const brandsTable = pgTable("brands", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  colorPrimary: text("color_primary").notNull().default("#3B82F6"),
  colorSecondary: text("color_secondary").notNull().default("#1E3A5F"),
  colorAccent: text("color_accent").notNull().default("#60A5FA"),
  colorBackground: text("color_background").notNull().default("#0A0A0F"),
  voiceDescription: text("voice_description").notNull().default(""),
  bannedTerms: text("banned_terms").array().notNull().default([]),
  trademarkRules: text("trademark_rules").notNull().default(""),
  hashtagStrategy: json("hashtag_strategy").notNull().default({}),
  characterStyleRules: text("character_style_rules").notNull().default(""),
  imagenPrefix: text("imagen_prefix").notNull().default(""),
  negativePrompt: text("negative_prompt").notNull().default(""),
  platformRules: json("platform_rules").notNull().default({}),
  logoFileUrl: text("logo_file_url"),
  brandFonts: json("brand_fonts"),
  brandAssetConfig: json("brand_asset_config"),
  // Taste learning loop: current distilled "what we've learned" guidance,
  // injected into image + caption prompts. Versions live in
  // taste_guidance_versions; this holds the active text for fast reads.
  tasteGuidance: text("taste_guidance").notNull().default(""),
  tasteGuidanceVersion: integer("taste_guidance_version").notNull().default(0),
  // Co-pilot Studio: 3-5 example posts in the brand's voice, used as few-shot
  // samples in every caption call. Nullable — brands without examples get
  // standard voice-description guidance only.
  voiceExamples: json("voice_examples").$type<string[]>(),
  timezone: text("timezone").notNull().default("America/New_York"),
  isActive: boolean("is_active").notNull().default(true),

  // --- Migration M1 · the brand record becomes complete ---
  // Spec: SparqMake Sandbox/21_SPEC_01_DATA_MODEL.md §2.1.
  //
  // Every column here is nullable or defaulted, so M1 is purely additive and
  // needs no backfill to apply. They land in one migration rather than one per
  // phase because a second ALTER on `brands` buys nothing and this repo has
  // already been bitten twice by migration churn.

  // Phase 9, the mixer. Prose, injected into the audio direction.
  soundDirection: text("sound_direction"),
  // ElevenLabs voice id for narration, plus a human label for the picker.
  narratorVoiceId: text("narrator_voice_id"),
  narratorDescription: text("narrator_description"),

  // Where applied Performance conclusions land. Each rule carries its own `n`,
  // which is what keeps a small-sample finding from reading as brand law.
  compositionRules: jsonb("composition_rules").$type<CompositionRule[]>().notNull().default([]),

  // Phase 5. The PDF the record was extracted from, kept so a field's stated
  // provenance can be traced back to a real document.
  brandGuideFileUrl: text("brand_guide_file_url"),

  // Principle 1.17, the load-bearing one: this is what stops an automated
  // suggestion from quietly becoming brand law. A field written by extraction or
  // by performance is marked as such, so the UI can show who decided it and a
  // human can overrule it.
  fieldProvenance: jsonb("field_provenance").$type<Record<string, FieldSource>>().notNull().default({}),

  // 0-100, recomputed on write. Nullable rather than defaulted to 0, because an
  // unscored brand and a brand that genuinely scored zero are different facts
  // and only one of them should read as "nothing filled in".
  completenessScore: integer("completeness_score"),

  // Stage 02 Direction. The locked default director. Null means no default, so
  // the spread ranks personas itself. SET NULL on delete matches
  // creatives.personaId: losing a persona must never delete a brand.
  defaultPersonaId: text("default_persona_id").references(() => designerPersonasTable.id, { onDelete: "set null" }),

  // How many takes stage 03 opens with. Spec range is 4-12; the range is
  // enforced at the route layer alongside the other brand validations rather
  // than as a check constraint, so an out-of-range value fails as a readable
  // 400 instead of a database error.
  defaultSpreadSize: integer("default_spread_size").default(8),

  // Phase 7. Soft cap, nullable: no budget set is not the same as a zero budget.
  monthlyBudgetCents: integer("monthly_budget_cents"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBrandSchema = createInsertSchema(brandsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBrand = z.infer<typeof insertBrandSchema>;
export type Brand = typeof brandsTable.$inferSelect;
