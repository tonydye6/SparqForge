-- Add timezone column to brands table
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "timezone" text NOT NULL DEFAULT 'America/New_York';

-- Add schedule_method and proposal_id columns to calendar_entries
ALTER TABLE "calendar_entries" ADD COLUMN IF NOT EXISTS "schedule_method" text NOT NULL DEFAULT 'manual';
ALTER TABLE "calendar_entries" ADD COLUMN IF NOT EXISTS "proposal_id" text;

-- Create brand_schedule_profiles table
CREATE TABLE IF NOT EXISTS "brand_schedule_profiles" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" text NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
  "platform" text NOT NULL,
  "day_of_week" integer NOT NULL,
  "hour" integer NOT NULL,
  "score" real NOT NULL DEFAULT 0.5,
  "status" text NOT NULL DEFAULT 'acceptable',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "brand_schedule_profiles_unique_idx" ON "brand_schedule_profiles" ("brand_id", "platform", "day_of_week", "hour");
CREATE INDEX IF NOT EXISTS "brand_schedule_profiles_brand_idx" ON "brand_schedule_profiles" ("brand_id", "platform");

-- Create smart_schedule_proposals table
CREATE TABLE IF NOT EXISTS "smart_schedule_proposals" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "creative_id" text NOT NULL REFERENCES "creatives"("id") ON DELETE CASCADE,
  "variant_id" text NOT NULL REFERENCES "creative_variants"("id") ON DELETE CASCADE,
  "platform" text NOT NULL,
  "proposed_at" timestamp NOT NULL,
  "rationale" text,
  "slot_score" real,
  "status" text NOT NULL DEFAULT 'pending',
  "final_time" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "smart_schedule_proposals_creative_idx" ON "smart_schedule_proposals" ("creative_id");
