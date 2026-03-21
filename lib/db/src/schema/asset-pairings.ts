import { pgTable, text, boolean, timestamp, integer, real, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assetPairingsTable = pgTable("asset_pairings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").notNull(),
  primaryAssetId: text("primary_asset_id").notNull(),
  secondaryAssetId: text("secondary_asset_id").notNull(),
  templateId: text("template_id"),
  platform: text("platform"),
  firstPassApproved: boolean("first_pass_approved"),
  totalRefinements: integer("total_refinements").notNull().default(0),
  finalStatus: text("final_status"),
  usageCount: integer("usage_count").notNull().default(1),
  avgApprovalScore: real("avg_approval_score"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("asset_pairings_primary_idx").on(table.primaryAssetId),
  index("asset_pairings_secondary_idx").on(table.secondaryAssetId),
  index("asset_pairings_template_idx").on(table.templateId),
  index("asset_pairings_campaign_idx").on(table.campaignId),
]);

export const insertAssetPairingSchema = createInsertSchema(assetPairingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAssetPairing = z.infer<typeof insertAssetPairingSchema>;
export type AssetPairing = typeof assetPairingsTable.$inferSelect;
