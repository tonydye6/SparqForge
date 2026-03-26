import { pgTable, text, timestamp, json, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativesTable } from "./campaigns";
import { templatesTable } from "./templates";
import { assetsTable } from "./assets";

export const generationPacketLogsTable = pgTable("generation_packet_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  creativeId: text("creative_id").notNull().references(() => creativesTable.id, { onDelete: "cascade" }),
  platform: text("platform"),
  templateId: text("template_id").references(() => templatesTable.id, { onDelete: "set null" }),
  packetType: text("packet_type"),
  primaryAssetId: text("primary_asset_id").references(() => assetsTable.id, { onDelete: "set null" }),
  supportingAssetIds: json("supporting_asset_ids"),
  styleAssetIds: json("style_asset_ids"),
  contextAssetIds: json("context_asset_ids"),
  compositingAssetIds: json("compositing_asset_ids"),
  excludedAssetIds: json("excluded_asset_ids"),
  packetReasoning: json("packet_reasoning"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("gen_packet_logs_campaign_idx").on(table.creativeId),
  index("gen_packet_logs_template_idx").on(table.templateId),
]);

export const insertGenerationPacketLogSchema = createInsertSchema(generationPacketLogsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertGenerationPacketLog = z.infer<typeof insertGenerationPacketLogSchema>;
export type GenerationPacketLog = typeof generationPacketLogsTable.$inferSelect;
