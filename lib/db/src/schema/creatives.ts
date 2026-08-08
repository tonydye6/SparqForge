import { pgTable, text, timestamp, json, index, real, integer, numeric, boolean, foreignKey, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";
import { styleProfilesTable } from "./style-profiles";
import { designerPersonasTable } from "./designer-personas";
import { templatesTable } from "./templates";
import { socialAccountsTable } from "./social-accounts";
import { usersTable } from "./users";

export const creativesTable = pgTable("creatives", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  templateId: text("template_id").references(() => templatesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  briefText: text("brief_text"),
  referenceUrl: text("reference_url"),
  referenceAnalysis: json("reference_analysis"),
  referenceScreenshots: json("reference_screenshots"),
  selectedAssets: json("selected_assets").notNull().default([]),
  selectedHashtagSets: json("selected_hashtag_sets"),
  sourceCreativeId: text("source_creative_id"),
  // Beat 1 (Home) concept ideation: the snapshot of suggested concept cards and
  // which one (if any) seeded this creative. Both nullable — the express path
  // (free prompt, no card) leaves them empty.
  conceptSuggestions: json("concept_suggestions"),
  selectedConceptId: text("selected_concept_id"),
  // Goal-aware posting: the strategic intent behind this creative (one of the
  // intent taxonomy keys, e.g. awareness | acquisition | community_engagement |
  // recognition_reward | announcement_launch | education | retention). Nullable —
  // creatives predating the intent engine, or where the creator skipped it.
  intent: text("intent"),
  // Snapshot of the Claude intent inference that produced `intent`:
  // { intent, confidence, alternates: [{intent, confidence}], reasoning }.
  // Kept for audit/analysis; NULL when intent was set manually or via concept.
  intentInference: json("intent_inference"),
  // The design style profile chosen for this creative's generations (nullable;
  // falls back to the brand's default style, or no style at all). Persisted so
  // regenerate/vary/takes reuse the same style.
  styleProfileId: text("style_profile_id").references(() => styleProfilesTable.id, { onDelete: "set null" }),
  // Designer Persona ("Inspired by ...") chosen for this creative's
  // generations. Account-scoped style inspiration whose fingerprint takes
  // look-and-feel precedence over the style profile. Nullable — no persona.
  personaId: text("persona_id").references(() => designerPersonasTable.id, { onDelete: "set null" }),
  // The compositing logo chosen for this creative's generations. Values:
  //   NULL   — auto (style profile's default logo → brand default logo)
  //   "none" — explicitly no logo overlay
  //   <id>   — a specific compositing logo asset (no FK so the "none" sentinel
  //            and deleted-asset fallback stay representable).
  selectedLogoAssetId: text("selected_logo_asset_id"),
  // Weighted reference system: how attached reference slots + prompt emphasis
  // balance subject fidelity vs style fidelity. One of subject|balanced|style.
  referenceBalance: text("reference_balance").notNull().default("balanced"),
  // Influences-preview overrides persisted on the creative:
  // { removedAssetIds: string[], pinnedAssetIds: string[] }. Removed assets are
  // excluded from packet assembly; pinned assets are forced into attached slots.
  referenceOverrides: json("reference_overrides"),
  // How generated takes are produced:
  //   "scene"    — single AI image (current default pipeline)
  //   "designed" — multi-layer composited designer graphic (design-spec LLM →
  //                subject cutout → typographic compositor → texture pass).
  renderMode: text("render_mode").notNull().default("scene"),
  estimatedCost: real("estimated_cost"),
  createdBy: text("created_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  reviewedBy: text("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewComment: text("review_comment"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("creatives_brand_status_idx").on(table.brandId, table.status),
  index("creatives_template_created_idx").on(table.templateId, table.createdAt),
  foreignKey({
    columns: [table.sourceCreativeId],
    foreignColumns: [table.id],
    name: "creatives_source_creative_id_creatives_id_fk",
  }).onDelete("set null"),
]);

export const insertCreativeSchema = createInsertSchema(creativesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCreative = z.infer<typeof insertCreativeSchema>;
export type Creative = typeof creativesTable.$inferSelect;

export const creativeVariantsTable = pgTable("creative_variants", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  creativeId: text("creative_id").notNull().references(() => creativesTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),
  rawImageUrl: text("raw_image_url"),
  compositedImageUrl: text("composited_image_url"),
  videoUrl: text("video_url"),
  audioSource: text("audio_source"),
  audioUrl: text("audio_url"),
  mergedVideoUrl: text("merged_video_url"),
  caption: text("caption").notNull().default(""),
  originalCaption: text("original_caption"),
  headlineText: text("headline_text"),
  originalHeadline: text("original_headline"),
  status: text("status").notNull().default("generated"),
  // Stores the failure reason (text) when image compositing failed for this
  // variant; NULL means compositing succeeded or was not attempted.
  compositingFailed: text("compositing_failed"),
  // Beat 2 (Board) Vary lineage: the variant this one was varied from, and the
  // constraint mode used (more_like_this | keep_style | keep_subject). Both
  // nullable — original generations have no source and no vary mode.
  sourceVariantId: text("source_variant_id"),
  varyMode: text("vary_mode"),
  // Beat 4 (Fan-out) N1: normalized (0..1) subject focal point used to reframe
  // this image to other aspect ratios without clipping the subject. Detected by
  // vision on the winning take, copied to each platform variant, manually
  // nudgeable per variant. NULL falls back to a centered crop.
  focalX: real("focal_x"),
  focalY: real("focal_y"),
  // Normalized (0..1) subject bounding box {x0,y0,x1,y1}, detected with the
  // focal point on the winning take. Drives clip prediction + escalation when
  // reframing. Stored on the source take; platform variants reference it via
  // source_variant_id.
  subjectBox: json("subject_box"),
  // Set on a platform variant when the reframe was predicted to clip the subject
  // (drives the ⚠ + escalation choice in the fan-out grid). NULL = not evaluated.
  clipWarning: boolean("clip_warning"),
  // How the headline typography got onto the composited image:
  //   "rendered" — the image model painted the headline into the scene (art-
  //   directed typography, verified by OCR); fan-out re-renders per aspect.
  //   "overlay" (or NULL) — the design-aware SVG overlay path composited it.
  headlineRenderMode: text("headline_render_mode"),
  // Designer-persona compare mode: which persona produced this take. Labels
  // side-by-side compare takes; NULL for normal generations.
  personaId: text("persona_id").references(() => designerPersonasTable.id, { onDelete: "set null" }),

  // --- Migration M4 · region edits, the second text layer, and motion ---
  // Spec: SparqMake Sandbox/21_SPEC_01_DATA_MODEL.md §2.2 and §4.4.
  // All nullable, so M4 is additive and needs no backfill.

  // Stage 03 is medium-polymorphic (§1.2): Image for a still, Motion for a
  // video. NULL reads as "image" for every row that predates this.
  mediumType: text("medium_type"),

  // How image-to-video stays non-destructive: the still remains its own variant
  // and the motion points back at it, so a channel can take either medium from
  // one creative. Self-reference, so it is typed rather than inferred.
  sourceImageVariantId: text("source_image_variant_id"),

  // The second text layer, alongside headlineText. Mirrors the headline's render
  // mode rather than inventing a second vocabulary for the same choice.
  hookText: text("hook_text"),
  hookRenderMode: text("hook_render_mode"),

  // Generated subtitle track for motion.
  captionsVtt: text("captions_vtt"),

  // Region-edit drift: how much of the image changed OUTSIDE the mask the user
  // drew. The number that matters, because an edit that quietly repaints the
  // whole frame is the failure mode of every masked-edit feature, and §1.17 says
  // it has to be inspectable rather than trusted.
  driftPercent: real("drift_percent"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("creative_variants_creative_idx").on(table.creativeId),
  foreignKey({
    columns: [table.sourceVariantId],
    foreignColumns: [table.id],
    name: "creative_variants_source_variant_id_fk",
  }).onDelete("set null"),
]);

export const calendarEntriesTable = pgTable("calendar_entries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  creativeId: text("creative_id").notNull().references(() => creativesTable.id, { onDelete: "cascade" }),
  variantId: text("variant_id").notNull().references(() => creativeVariantsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  socialAccountId: text("social_account_id").references(() => socialAccountsTable.id, { onDelete: "set null" }),
  scheduledAt: timestamp("scheduled_at").notNull(),
  publishedAt: timestamp("published_at"),
  publishStatus: text("publish_status").notNull().default("scheduled"),
  publishError: text("publish_error"),
  // Platform-native ID of the published post (tweet ID, IG media ID, LinkedIn
  // post URN, TikTok post ID, YouTube video ID). Set on successful publish;
  // required for metrics ingestion. NULL for entries published before this
  // column existed or when the platform did not return an ID.
  platformPostId: text("platform_post_id"),
  retryCount: integer("retry_count").notNull().default(0),
  // Set when a permanent-failure alert covering this entry was delivered.
  // NULL means "not alerted yet" — the scheduler's alert sweep picks the entry
  // up. Reset to NULL on manual retry so a later permanent failure re-alerts.
  alertedAt: timestamp("alerted_at"),
  // Copied from the creative at scheduling time so per-intent performance can
  // be analyzed later even if the creative's intent changes. Nullable for
  // entries created before the intent engine or from intent-less creatives.
  intent: text("intent"),
  scheduleMethod: text("schedule_method").notNull().default("manual"),
  smartScheduleRationale: text("smart_schedule_rationale"),
  proposalId: text("proposal_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("calendar_entries_status_scheduled_idx").on(table.publishStatus, table.scheduledAt),
  check(
    "calendar_entries_publish_status_check",
    sql`${table.publishStatus} in ('scheduled', 'publishing', 'published', 'failed')`,
  ),
]);

export const smartScheduleProposalsTable = pgTable("smart_schedule_proposals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  creativeId: text("creative_id").notNull().references(() => creativesTable.id, { onDelete: "cascade" }),
  variantId: text("variant_id").notNull().references(() => creativeVariantsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  proposedAt: timestamp("proposed_at").notNull(),
  score: real("score").notNull().default(0),
  slotScore: real("slot_score"),
  rationale: text("rationale"),
  status: text("status").notNull().default("pending"),
  confirmedAt: timestamp("confirmed_at"),
  finalTime: timestamp("final_time"),
  calendarEntryId: text("calendar_entry_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("smart_schedule_proposals_creative_idx").on(table.creativeId),
]);

export const refinementLogsTable = pgTable("refinement_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  creativeId: text("creative_id").references(() => creativesTable.id, { onDelete: "set null" }),
  templateId: text("template_id").notNull().references(() => templatesTable.id, { onDelete: "cascade" }),
  editType: text("edit_type").notNull(),
  platform: text("platform"),
  aspectRatio: text("aspect_ratio"),
  originalValue: text("original_value"),
  newValue: text("new_value"),
  refinementPrompt: text("refinement_prompt"),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("refinement_logs_template_idx").on(table.templateId, table.editType),
]);

/**
 * How a row's `costUsd` was arrived at. Recorded because the number is stored
 * at spend time but is usually an ESTIMATE, and a column that cannot say so
 * reads as a measurement (Principle 1.17 / 2.9 — visible cost).
 *
 *  - `measured_tokens`     real token usage came back from the vendor
 *  - `estimate_flat`       a flat per-call constant from COST_ESTIMATES
 *  - `estimate_from_bytes` video, whose duration is guessed from buffer size
 *  - `reservation`         a budget hold, deleted on settle; never real spend
 *  - `pre_m2_estimate`     written before M2, basis unknown and unrecoverable
 *
 * Deliberately NOT a pg enum: adding a basis would then need a migration, and
 * this describes how we measured rather than what the spine's shape is.
 */
export type CostPricingBasis =
  | "measured_tokens"
  | "estimate_flat"
  | "estimate_from_bytes"
  | "reservation"
  | "pre_m2_estimate";

export const COST_PRICING_BASES = [
  "measured_tokens",
  "estimate_flat",
  "estimate_from_bytes",
  "reservation",
  "pre_m2_estimate",
] as const satisfies readonly CostPricingBasis[];

/** Two-pass accounting: a cheap preview spread, full resolution only on keeps. */
export type CostPassType = "preview" | "full";

export const costLogsTable = pgTable("cost_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  creativeId: text("creative_id").references(() => creativesTable.id, { onDelete: "set null" }),
  /**
   * M2. Direct brand attribution, and NOT merely a convenience join.
   * `creativeId` is `on delete set null`, so deleting a creative silently
   * orphaned every cost row it caused — the spend stayed in the totals with
   * nothing to attribute it to. `set null` here too, so deleting a brand keeps
   * the money visible in lifetime totals rather than vanishing it.
   */
  brandId: text("brand_id").references(() => brandsTable.id, { onDelete: "set null" }),
  service: text("service").notNull(),
  operation: text("operation").notNull(),
  model: text("model"),
  costUsd: numeric("cost_usd", { precision: 12, scale: 4, mode: "number" }).notNull(),
  /**
   * M2. Deliberately no `amountCents` (doc 21 §2.3 specified one). `costUsd`
   * already stores the amount at spend time to four decimals, so cents would be
   * a second source of truth that also LOSES precision: the $0.002 Gemini text
   * rows round to 0. Doc 21 assumed no dollar column existed; it does.
   */
  pricingBasis: text("pricing_basis").$type<CostPricingBasis>(),
  passType: text("pass_type").$type<CostPassType>(),
  /**
   * M2. FALSE once a take is culled and never published — this is what makes
   * wasted spend its own colour on the Cost surface. NULL means "not part of a
   * two-pass flow", which is not the same as unused.
   */
  wasUsed: boolean("was_used"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("cost_logs_created_at_idx").on(table.createdAt.desc()),
  index("cost_logs_service_created_at_idx").on(table.service, table.createdAt.desc()),
  index("cost_logs_brand_created_at_idx").on(table.brandId, table.createdAt.desc()),
  check(
    "cost_logs_pricing_basis_check",
    sql`${table.pricingBasis} IS NULL OR ${table.pricingBasis} IN ('measured_tokens', 'estimate_flat', 'estimate_from_bytes', 'reservation', 'pre_m2_estimate')`,
  ),
  check(
    "cost_logs_pass_type_check",
    sql`${table.passType} IS NULL OR ${table.passType} IN ('preview', 'full')`,
  ),
]);

export type CostLog = typeof costLogsTable.$inferSelect;

// Monthly rollups of archived cost_logs rows. The archival job (see
// scripts/src/archive-cost-logs.ts) rolls up whole calendar months that are
// entirely older than the retention window into this table and deletes the raw
// rows, keeping cost_logs lean while preserving lifetime totals. Archival is
// whole-month aligned, so this table and cost_logs never cover the same month,
// which lets the analytics endpoint combine them without double counting.
export const costLogMonthlySummaryTable = pgTable("cost_log_monthly_summary", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  // First day of the rolled-up calendar month, at 00:00:00 UTC.
  month: timestamp("month").notNull(),
  service: text("service").notNull(),
  operation: text("operation").notNull(),
  totalCostUsd: numeric("total_cost_usd", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
  entryCount: integer("entry_count").notNull().default(0),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cost_log_monthly_summary_unique_idx").on(table.month, table.service, table.operation),
  index("cost_log_monthly_summary_month_idx").on(table.month.desc()),
]);

export type CostLogMonthlySummary = typeof costLogMonthlySummaryTable.$inferSelect;

export const brandScheduleProfilesTable = pgTable("brand_schedule_profiles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  hour: integer("hour").notNull(),
  score: real("score").notNull().default(0.5),
  status: text("status").notNull().default("acceptable"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("brand_schedule_profiles_unique_idx").on(table.brandId, table.platform, table.dayOfWeek, table.hour),
  index("brand_schedule_profiles_brand_idx").on(table.brandId, table.platform),
]);
