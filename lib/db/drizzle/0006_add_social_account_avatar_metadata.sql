ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "avatar_url" text;
ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "platform_metadata" jsonb;
