-- Incremental migration: Add all FK constraints and compositing_failed column
-- Safe to run on existing data — uses IF NOT EXISTS guards throughout.
-- All orphan data cleaned before FK application.

-- Add compositing_failed column to campaign_variants
ALTER TABLE "campaign_variants" ADD COLUMN IF NOT EXISTS "compositing_failed" text;

-- campaigns.source_campaign_id → campaigns.id (self-ref)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'campaigns_source_campaign_id_campaigns_id_fk' AND table_name = 'campaigns') THEN
    ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_source_campaign_id_campaigns_id_fk" FOREIGN KEY ("source_campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- campaigns.brand_id → brands.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'campaigns_brand_id_brands_id_fk' AND table_name = 'campaigns') THEN
    ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- campaigns.template_id → templates.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'campaigns_template_id_templates_id_fk' AND table_name = 'campaigns') THEN
    ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- campaign_variants.campaign_id → campaigns.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'campaign_variants_campaign_id_campaigns_id_fk' AND table_name = 'campaign_variants') THEN
    ALTER TABLE "campaign_variants" ADD CONSTRAINT "campaign_variants_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- calendar_entries.campaign_id → campaigns.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'calendar_entries_campaign_id_campaigns_id_fk' AND table_name = 'calendar_entries') THEN
    ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- calendar_entries.variant_id → campaign_variants.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'calendar_entries_variant_id_campaign_variants_id_fk' AND table_name = 'calendar_entries') THEN
    ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_variant_id_campaign_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "campaign_variants"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- calendar_entries.social_account_id → social_accounts.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'calendar_entries_social_account_id_social_accounts_id_fk' AND table_name = 'calendar_entries') THEN
    ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- assets.brand_id → brands.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'assets_brand_id_brands_id_fk' AND table_name = 'assets') THEN
    ALTER TABLE "assets" ADD CONSTRAINT "assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- templates.brand_id → brands.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'templates_brand_id_brands_id_fk' AND table_name = 'templates') THEN
    ALTER TABLE "templates" ADD CONSTRAINT "templates_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- hashtag_sets.brand_id → brands.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'hashtag_sets_brand_id_brands_id_fk' AND table_name = 'hashtag_sets') THEN
    ALTER TABLE "hashtag_sets" ADD CONSTRAINT "hashtag_sets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- social_accounts.brand_id → brands.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'social_accounts_brand_id_brands_id_fk' AND table_name = 'social_accounts') THEN
    ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- cost_logs.campaign_id → campaigns.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'cost_logs_campaign_id_campaigns_id_fk' AND table_name = 'cost_logs') THEN
    ALTER TABLE "cost_logs" ADD CONSTRAINT "cost_logs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- refinement_logs.campaign_id → campaigns.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'refinement_logs_campaign_id_campaigns_id_fk' AND table_name = 'refinement_logs') THEN
    ALTER TABLE "refinement_logs" ADD CONSTRAINT "refinement_logs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- refinement_logs.template_id → templates.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'refinement_logs_template_id_templates_id_fk' AND table_name = 'refinement_logs') THEN
    ALTER TABLE "refinement_logs" ADD CONSTRAINT "refinement_logs_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- generation_packet_logs.campaign_id → campaigns.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'generation_packet_logs_campaign_id_campaigns_id_fk' AND table_name = 'generation_packet_logs') THEN
    ALTER TABLE "generation_packet_logs" ADD CONSTRAINT "generation_packet_logs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- generation_packet_logs.template_id → templates.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'generation_packet_logs_template_id_templates_id_fk' AND table_name = 'generation_packet_logs') THEN
    ALTER TABLE "generation_packet_logs" ADD CONSTRAINT "generation_packet_logs_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- generation_packet_logs.primary_asset_id → assets.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'generation_packet_logs_primary_asset_id_assets_id_fk' AND table_name = 'generation_packet_logs') THEN
    ALTER TABLE "generation_packet_logs" ADD CONSTRAINT "generation_packet_logs_primary_asset_id_assets_id_fk" FOREIGN KEY ("primary_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- asset_pairings.campaign_id → campaigns.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'asset_pairings_campaign_id_campaigns_id_fk' AND table_name = 'asset_pairings') THEN
    ALTER TABLE "asset_pairings" ADD CONSTRAINT "asset_pairings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- asset_pairings.primary_asset_id → assets.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'asset_pairings_primary_asset_id_assets_id_fk' AND table_name = 'asset_pairings') THEN
    ALTER TABLE "asset_pairings" ADD CONSTRAINT "asset_pairings_primary_asset_id_assets_id_fk" FOREIGN KEY ("primary_asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- asset_pairings.secondary_asset_id → assets.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'asset_pairings_secondary_asset_id_assets_id_fk' AND table_name = 'asset_pairings') THEN
    ALTER TABLE "asset_pairings" ADD CONSTRAINT "asset_pairings_secondary_asset_id_assets_id_fk" FOREIGN KEY ("secondary_asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- asset_pairings.template_id → templates.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'asset_pairings_template_id_templates_id_fk' AND table_name = 'asset_pairings') THEN
    ALTER TABLE "asset_pairings" ADD CONSTRAINT "asset_pairings_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- template_versions.template_id → templates.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'template_versions_template_id_templates_id_fk' AND table_name = 'template_versions') THEN
    ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- template_recommendations.template_id → templates.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'template_recommendations_template_id_templates_id_fk' AND table_name = 'template_recommendations') THEN
    ALTER TABLE "template_recommendations" ADD CONSTRAINT "template_recommendations_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- social_content_plan_items.linked_campaign_id → campaigns.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'social_content_plan_items_linked_campaign_id_campaigns_id_fk' AND table_name = 'social_content_plan_items') THEN
    ALTER TABLE "social_content_plan_items" ADD CONSTRAINT "social_content_plan_items_linked_campaign_id_campaigns_id_fk" FOREIGN KEY ("linked_campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL;
  END IF;
END $$;
