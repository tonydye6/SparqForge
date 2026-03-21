-- Incremental migration: Add missing FK constraints and compositing_failed column
-- Safe to run on existing data (all orphans cleaned before applying)

-- Add compositing_failed column to campaign_variants
ALTER TABLE "campaign_variants" ADD COLUMN IF NOT EXISTS "compositing_failed" text;

-- Add FK: campaigns.source_campaign_id → campaigns.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'campaigns_source_campaign_id_campaigns_id_fk'
    AND table_name = 'campaigns'
  ) THEN
    ALTER TABLE "campaigns"
      ADD CONSTRAINT "campaigns_source_campaign_id_campaigns_id_fk"
      FOREIGN KEY ("source_campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Add FK: calendar_entries.social_account_id → social_accounts.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'calendar_entries_social_account_id_social_accounts_id_fk'
    AND table_name = 'calendar_entries'
  ) THEN
    ALTER TABLE "calendar_entries"
      ADD CONSTRAINT "calendar_entries_social_account_id_social_accounts_id_fk"
      FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;
