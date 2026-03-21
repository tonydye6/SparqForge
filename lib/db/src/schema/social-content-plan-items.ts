import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const socialContentPlanItemsTable = pgTable("social_content_plan_items", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  campaignName: text("campaign_name"),
  primaryPlatform: text("primary_platform").notNull(),
  secondaryPlatforms: text("secondary_platforms").array().notNull().default([]),
  templateName: text("template_name"),
  pillar: text("pillar"),
  audience: text("audience"),
  brandLayer: text("brand_layer"),
  objective: text("objective"),
  contentType: text("content_type"),
  assetPacketType: text("asset_packet_type"),
  coreMessage: text("core_message"),
  cta: text("cta"),
  requiredAssetRoles: text("required_asset_roles").array().notNull().default([]),
  status: text("status").notNull().default("planned"),
  plannedWeek: text("planned_week"),
  plannedDate: text("planned_date"),
  notes: text("notes"),
  linkedCampaignId: text("linked_campaign_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("plan_items_status_idx").on(table.status),
  index("plan_items_pillar_idx").on(table.pillar),
  index("plan_items_platform_idx").on(table.primaryPlatform),
  index("plan_items_week_idx").on(table.plannedWeek),
]);

export const insertPlanItemSchema = createInsertSchema(socialContentPlanItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPlanItem = z.infer<typeof insertPlanItemSchema>;
export type PlanItem = typeof socialContentPlanItemsTable.$inferSelect;
