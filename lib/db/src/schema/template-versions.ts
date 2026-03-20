import { pgTable, text, integer, json, timestamp } from "drizzle-orm/pg-core";

export const templateVersionsTable = pgTable("template_versions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  templateId: text("template_id").notNull(),
  version: integer("version").notNull(),
  snapshot: json("snapshot").notNull(),
  changedFields: text("changed_fields").array().notNull().default([]),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TemplateVersion = typeof templateVersionsTable.$inferSelect;
