-- Migration: Add character_style_rules to brands and character_identity_note to assets
-- Both columns default to empty string for backward compatibility with existing data.

ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "character_style_rules" text NOT NULL DEFAULT '';
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "character_identity_note" text NOT NULL DEFAULT '';
