import { pgTable, text, boolean, timestamp, integer, index, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assetsTable = pgTable("assets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  brandId: text("brand_id").notNull(),
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

  assetClass: text("asset_class").notNull().default("subject_reference"),
  generationRole: text("generation_role"),
  brandLayer: text("brand_layer"),
  franchise: text("franchise"),
  approvedChannels: text("approved_channels").array().notNull().default([]),
  approvedTemplates: text("approved_templates").array().notNull().default([]),
  subjectIdentityScore: integer("subject_identity_score").notNull().default(3),
  styleStrengthScore: integer("style_strength_score").notNull().default(3),
  compositingOnly: boolean("compositing_only").notNull().default(false),
  generationAllowed: boolean("generation_allowed").notNull().default(true),
  approvedForCompositing: boolean("approved_for_compositing").notNull().default(false),
  referencePriorityDefault: integer("reference_priority_default").notNull().default(3),
  conflictTags: text("conflict_tags").array().notNull().default([]),
  freshnessScore: integer("freshness_score").notNull().default(3),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("assets_brand_status_idx").on(table.brandId, table.status),
  index("assets_brand_type_idx").on(table.brandId, table.type),
  index("assets_brand_asset_class_idx").on(table.brandId, table.assetClass),
  index("assets_brand_gen_allowed_idx").on(table.brandId, table.generationAllowed),
  index("assets_brand_franchise_idx").on(table.brandId, table.franchise),
]);

export const insertAssetSchema = createInsertSchema(assetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
