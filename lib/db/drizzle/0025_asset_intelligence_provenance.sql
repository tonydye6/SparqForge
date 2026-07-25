ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "ai_suggested_fields" text[] DEFAULT '{}';
