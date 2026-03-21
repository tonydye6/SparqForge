import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";

export const hashtagSetsTable = pgTable("hashtag_sets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  brandId: text("brand_id").notNull().references(() => brandsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hashtags: text("hashtags").array().notNull().default([]),
  category: text("category").notNull(),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("hashtag_sets_brand_category_idx").on(table.brandId, table.category),
]);

export const insertHashtagSetSchema = createInsertSchema(hashtagSetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertHashtagSet = z.infer<typeof insertHashtagSetSchema>;
export type HashtagSet = typeof hashtagSetsTable.$inferSelect;
