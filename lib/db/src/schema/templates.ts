import { pgTable, text, boolean, timestamp, json, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const templatesTable = pgTable("templates", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  brandId: text("brand_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  version: integer("version").notNull().default(1),
  imagenPromptAddition: text("imagen_prompt_addition").notNull().default(""),
  imagenNegativeAddition: text("imagen_negative_addition").notNull().default(""),
  claudeCaptionInstruction: json("claude_caption_instruction").notNull().default({}),
  claudeHeadlineInstruction: text("claude_headline_instruction"),
  layoutSpec: json("layout_spec"),
  recommendedAssetTypes: text("recommended_asset_types").array().notNull().default([]),
  targetAspectRatios: text("target_aspect_ratios").array().notNull().default(["1:1", "4:5", "9:16", "16:9"]),
  totalGenerations: integer("total_generations").notNull().default(0),
  firstPassApprovalRate: real("first_pass_approval_rate"),
  avgRefinementsBeforeApproval: real("avg_refinements_before_approval"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTemplateSchema = createInsertSchema(templatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templatesTable.$inferSelect;
