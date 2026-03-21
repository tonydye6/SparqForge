import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { brandsTable } from "./brands";

export const socialAccountsTable = pgTable("social_accounts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  platform: text("platform").notNull(),
  accountName: text("account_name").notNull(),
  accountId: text("account_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiry: timestamp("token_expiry"),
  brandId: text("brand_id").references(() => brandsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("connected"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("social_accounts_platform_idx").on(table.platform),
  index("social_accounts_brand_idx").on(table.brandId),
  index("social_accounts_status_idx").on(table.status),
]);

export const insertSocialAccountSchema = createInsertSchema(socialAccountsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSocialAccount = z.infer<typeof insertSocialAccountSchema>;
export type SocialAccount = typeof socialAccountsTable.$inferSelect;
