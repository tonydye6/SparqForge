import { pgTable, text, json, timestamp, index } from "drizzle-orm/pg-core";

export const templateRecommendationsTable = pgTable("template_recommendations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  templateId: text("template_id").notNull(),
  analysisData: json("analysis_data").notNull(),
  recommendations: json("recommendations").notNull(),
  status: text("status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at"),
  reviewerNotes: text("reviewer_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("template_recommendations_template_idx").on(table.templateId, table.status),
]);

export type TemplateRecommendation = typeof templateRecommendationsTable.$inferSelect;
