import { pgTable, text, boolean, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
  imagenPrefix: text("imagen_prefix").notNull().default(""),
  negativePrompt: text("negative_prompt").notNull().default(""),
  platformRules: json("platform_rules").notNull().default({}),
  logoFileUrl: text("logo_file_url"),
  brandFonts: json("brand_fonts"),
  isActive: boolean("is_active").notNull().default(true),
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
