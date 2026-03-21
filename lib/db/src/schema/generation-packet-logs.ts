import { pgTable, text, timestamp, json, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const generationPacketLogsTable = pgTable("generation_packet_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").notNull(),
  platform: text("platform"),
  templateId: text("template_id"),
  packetType: text("packet_type"),
  primaryAssetId: text("primary_asset_id"),
  supportingAssetIds: json("supporting_asset_ids"),
  styleAssetIds: json("style_asset_ids"),
  contextAssetIds: json("context_asset_ids"),
  compositingAssetIds: json("compositing_asset_ids"),
  excludedAssetIds: json("excluded_asset_ids"),
  packetReasoning: json("packet_reasoning"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("gen_packet_logs_campaign_idx").on(table.campaignId),
  index("gen_packet_logs_template_idx").on(table.templateId),
]);

export const insertGenerationPacketLogSchema = createInsertSchema(generationPacketLogsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertGenerationPacketLog = z.infer<typeof insertGenerationPacketLogSchema>;
export type GenerationPacketLog = typeof generationPacketLogsTable.$inferSelect;
