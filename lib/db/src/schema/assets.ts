import { pgTable, text, boolean, timestamp, integer, real, index, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";

/**
 * Where an asset sits in the trademark remediation, as a state rather than as
 * the presence or absence of a string.
 *
 *  - `clean`     scanned, no third-party mark found
 *  - `blocked`   a mark was found and no usable replacement exists yet
 *  - `retouched` a replacement was produced (see `retouchedToAssetId`)
 *  - `refused`   retouch was attempted and did not yield a usable result;
 *                `trademarkRefusalReason` says why. **This is the state the old
 *                encoding could not represent at all** — the 18 refusals were
 *                indistinguishable from never-scanned.
 *  - `replacement` this row IS a retouched output (see `retouchedFromAssetId`)
 *  - `review`    a mark was found that an existing licence may already cover,
 *                so the scanner declined to rule and a human with the licence
 *                terms has to. **Added because the 2026-08-08 re-scan returned
 *                two of these and the enum had nowhere to put them** — and
 *                folding an undecided verdict into `clean` would assert a
 *                ruling nobody made, which is the exact failure this table
 *                exists to prevent.
 *
 * Deliberately NOT a pg enum: a new outcome would otherwise need a migration,
 * and this describes how far remediation got, not the spine's shape.
 */
export type TrademarkScanState =
  | "clean"
  | "blocked"
  | "retouched"
  | "refused"
  | "replacement"
  | "review";

export const TRADEMARK_SCAN_STATES = [
  "clean",
  "blocked",
  "retouched",
  "refused",
  "replacement",
  "review",
] as const satisfies readonly TrademarkScanState[];

export const assetsTable = pgTable("assets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  subType: text("sub_type"),
  status: text("status").notNull().default("uploaded"),
  name: text("name").notNull(),
  description: text("description"),
  tags: text("tags").array().notNull().default([]),
  fileUrl: text("file_url"),
  thumbnailUrl: text("thumbnail_url"),
  content: text("content"),
  mimeType: text("mime_type"),
  fileSizeBytes: integer("file_size_bytes"),
  uploadedBy: text("uploaded_by").notNull(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  usageCount: integer("usage_count").notNull().default(0),
  assetClass: text("asset_class"),
  generationRole: text("generation_role"),
  brandLayer: text("brand_layer"),
  franchise: text("franchise"),
  approvedChannels: text("approved_channels").array().default([]),
  approvedTemplates: text("approved_templates").array().default([]),
  subjectIdentityScore: real("subject_identity_score"),
  styleStrengthScore: real("style_strength_score"),
  compositingOnly: boolean("compositing_only").default(false),
  generationAllowed: boolean("generation_allowed").default(true),
  approvedForCompositing: boolean("approved_for_compositing").default(false),
  referencePriorityDefault: real("reference_priority_default"),
  conflictTags: text("conflict_tags").array().default([]),
  freshnessScore: real("freshness_score"),
  characterIdentityNote: text("character_identity_note").notNull().default(""),
  depictedEntities: text("depicted_entities").array().default([]),
  colors: text("colors").array().default([]),
  styleNotes: text("style_notes"),
  aiAnalyzedAt: timestamp("ai_analyzed_at"),
  aiSuggestedFields: text("ai_suggested_fields").array().default([]),
  /**
   * M3 · trademark remediation, given somewhere durable to live.
   *
   * The August remediation recorded its entire outcome as prefixed STRINGS
   * pushed into `aiSuggestedFields` — `"retouched_to:<uuid>"` — an array whose
   * actual job is naming which fields an AI auto-filled. That encoding is why
   * three things could not be answered from the database:
   *
   *   1. **The 18 refusals left no trace.** A refusal is the absence of a
   *      `retouched_to` string, indistinguishable from never having been
   *      scanned. There was no work-list to retry from.
   *   2. **No scan verdict was kept.** Only ONE row library-wide carries
   *      `conflictTags`, so the scanner's 46 findings are gone; the shortlist
   *      in doc 27 is a markdown table, not data.
   *   3. **Review state had nowhere to go**, so the 28 replacements defaulted
   *      to `generationAllowed = true` — reachable by the Director while still
   *      unreviewed, and at least one still carrying a mark.
   *
   * Same shape as the reject reasons Phase 6 pulled out of a free-text field:
   * a fact in a string prefix can only be displayed, one in a column can be
   * queried, counted and gated on.
   */
  trademarkScanState: text("trademark_scan_state").$type<TrademarkScanState>(),
  trademarkScannedAt: timestamp("trademark_scanned_at"),
  /** Marks the scanner actually identified, e.g. ["nike_swoosh","big_ten"]. */
  trademarkMarks: text("trademark_marks").array().default([]),
  /** Why a retouch attempt did not produce a usable replacement. */
  trademarkRefusalReason: text("trademark_refusal_reason"),
  /**
   * Retouch lineage as real FKs instead of string prefixes. Self-referential,
   * so declared in the table callback below.
   */
  retouchedToAssetId: text("retouched_to_asset_id"),
  retouchedFromAssetId: text("retouched_from_asset_id"),
  /**
   * Human sign-off on a replacement. NULL means NOT YET REVIEWED, which
   * `asset-policy` treats as ineligible for generation — the default has to
   * fail closed, because the failure mode here is a trademark reaching output.
   */
  trademarkReviewedAt: timestamp("trademark_reviewed_at"),
  trademarkReviewedBy: text("trademark_reviewed_by"),
  lastUsedAt: timestamp("last_used_at"),
  fontWeight: text("font_weight"),
  fontName: text("font_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("assets_brand_status_idx").on(table.brandId, table.status),
  index("assets_brand_type_idx").on(table.brandId, table.type),
  index("assets_brand_asset_class_idx").on(table.brandId, table.assetClass),
  index("assets_brand_gen_allowed_idx").on(table.brandId, table.generationAllowed),
  index("assets_brand_franchise_idx").on(table.brandId, table.franchise),
  /**
   * The remediation work-list query: "everything in this brand still needing a
   * decision". Without it, finding the refusals means a full scan of the table.
   */
  index("assets_brand_trademark_state_idx").on(table.brandId, table.trademarkScanState),
  /*
   * Self-referential lineage. `set null` in both directions: losing a
   * replacement must never cascade-delete the original evidence, and losing an
   * original must never delete the clean replacement that is now in use.
   */
  foreignKey({
    columns: [table.retouchedToAssetId],
    foreignColumns: [table.id],
    name: "assets_retouched_to_asset_id_fk",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.retouchedFromAssetId],
    foreignColumns: [table.id],
    name: "assets_retouched_from_asset_id_fk",
  }).onDelete("set null"),
  check(
    "assets_trademark_scan_state_check",
    sql`${table.trademarkScanState} IS NULL OR ${table.trademarkScanState} IN ('clean', 'blocked', 'retouched', 'refused', 'replacement', 'review')`,
  ),
  /**
   * A refusal must say why. The whole reason the 18 refusals were unusable as a
   * work-list is that nothing recorded the reason, so this is enforced in the
   * database rather than left to the caller's good intentions.
   */
  check(
    "assets_trademark_refusal_reason_required_check",
    sql`${table.trademarkScanState} <> 'refused' OR ${table.trademarkRefusalReason} IS NOT NULL`,
  ),
]);

export const insertAssetSchema = createInsertSchema(assetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
