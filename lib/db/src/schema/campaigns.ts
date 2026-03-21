import { pgTable, text, timestamp, json, index, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";
import { templatesTable } from "./templates";
import { socialAccountsTable } from "./social-accounts";

export const campaignsTable = pgTable("campaigns", {
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
  sourceCampaignId: text("source_campaign_id").references((): any => campaignsTable.id, { onDelete: "set null" }),
  estimatedCost: real("estimated_cost"),
  createdBy: text("created_by").notNull(),
  reviewedBy: text("reviewed_by"),
  reviewComment: text("review_comment"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("campaigns_brand_status_idx").on(table.brandId, table.status),
  index("campaigns_template_created_idx").on(table.templateId, table.createdAt),
]);

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;

export const campaignVariantsTable = pgTable("campaign_variants", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
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
  compositingFailed: text("compositing_failed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("campaign_variants_campaign_idx").on(table.campaignId),
]);

export const calendarEntriesTable = pgTable("calendar_entries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  variantId: text("variant_id").notNull().references(() => campaignVariantsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  socialAccountId: text("social_account_id").references(() => socialAccountsTable.id, { onDelete: "set null" }),
  scheduledAt: timestamp("scheduled_at").notNull(),
  publishedAt: timestamp("published_at"),
  publishStatus: text("publish_status").notNull().default("scheduled"),
  publishError: text("publish_error"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("calendar_entries_schedule_idx").on(table.scheduledAt, table.publishStatus),
]);

export const refinementLogsTable = pgTable("refinement_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  templateId: text("template_id").notNull().references(() => templatesTable.id, { onDelete: "cascade" }),
  editType: text("edit_type").notNull(),
  platform: text("platform"),
  aspectRatio: text("aspect_ratio"),
  originalValue: text("original_value"),
  newValue: text("new_value"),
  refinementPrompt: text("refinement_prompt"),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("refinement_logs_template_idx").on(table.templateId, table.editType),
]);

export const costLogsTable = pgTable("cost_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  service: text("service").notNull(),
  operation: text("operation").notNull(),
  model: text("model"),
  costUsd: real("cost_usd").notNull(),
  inputTokens: text("input_tokens"),
  outputTokens: text("output_tokens"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
