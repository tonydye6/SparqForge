-- Rename campaigns table to creatives
ALTER TABLE "campaigns" RENAME TO "creatives";

-- Rename campaign_variants table to creative_variants
ALTER TABLE "campaign_variants" RENAME TO "creative_variants";

-- Rename source_campaign_id column in creatives
ALTER TABLE "creatives" RENAME COLUMN "source_campaign_id" TO "source_creative_id";

-- Rename campaign_id column in creative_variants
ALTER TABLE "creative_variants" RENAME COLUMN "campaign_id" TO "creative_id";

-- Rename campaign_id column in calendar_entries
ALTER TABLE "calendar_entries" RENAME COLUMN "campaign_id" TO "creative_id";

-- Rename campaign_id column in generation_packet_logs
ALTER TABLE "generation_packet_logs" RENAME COLUMN "campaign_id" TO "creative_id";

-- Rename campaign_id column in refinement_logs
ALTER TABLE "refinement_logs" RENAME COLUMN "campaign_id" TO "creative_id";

-- Rename campaign_id column in cost_logs
ALTER TABLE "cost_logs" RENAME COLUMN "campaign_id" TO "creative_id";

-- Rename campaign_id column in asset_pairings
ALTER TABLE "asset_pairings" RENAME COLUMN "campaign_id" TO "creative_id";

-- Rename linked_campaign_id column in social_content_plan_items
ALTER TABLE "social_content_plan_items" RENAME COLUMN "linked_campaign_id" TO "linked_creative_id";
