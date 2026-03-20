import { pgTable, text, boolean, timestamp, integer, index } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("assets_brand_status_idx").on(table.brandId, table.status),
  index("assets_brand_type_idx").on(table.brandId, table.type),
]);

export const insertAssetSchema = createInsertSchema(assetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
