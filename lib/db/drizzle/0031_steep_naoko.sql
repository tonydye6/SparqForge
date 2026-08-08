ALTER TABLE "assets" ADD COLUMN "trademark_scan_state" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "trademark_scanned_at" timestamp;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "trademark_marks" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "trademark_refusal_reason" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "retouched_to_asset_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "retouched_from_asset_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "trademark_reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "trademark_reviewed_by" text;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_retouched_to_asset_id_fk" FOREIGN KEY ("retouched_to_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_retouched_from_asset_id_fk" FOREIGN KEY ("retouched_from_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_brand_trademark_state_idx" ON "assets" USING btree ("brand_id","trademark_scan_state");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_trademark_scan_state_check" CHECK ("assets"."trademark_scan_state" IS NULL OR "assets"."trademark_scan_state" IN ('clean', 'blocked', 'retouched', 'refused', 'replacement'));--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_trademark_refusal_reason_required_check" CHECK ("assets"."trademark_scan_state" <> 'refused' OR "assets"."trademark_refusal_reason" IS NOT NULL);--> statement-breakpoint
-- M3 one-time backfill. Hand-appended below the generated DDL: data only, so it
-- does not affect 0031_snapshot.json and cannot cause meta drift.
--
-- Lifts the August remediation out of the `ai_suggested_fields` string array
-- into the real columns. The prefixed strings are left in place deliberately —
-- removing them would destroy the only evidence of what the old encoding said
-- while this backfill is still unproven in prod.
UPDATE "assets" a
   SET "retouched_to_asset_id" = sub.target,
       "trademark_scan_state"  = 'retouched'
  FROM (
    SELECT id, split_part(elem, ':', 2) AS target
      FROM "assets", unnest("ai_suggested_fields") AS elem
     WHERE elem LIKE 'retouched\_to:%'
  ) AS sub
 WHERE a.id = sub.id
   AND a."retouched_to_asset_id" IS NULL
   -- Only adopt a link whose target actually exists, or the FK rejects the row.
   AND EXISTS (SELECT 1 FROM "assets" t WHERE t.id = sub.target);--> statement-breakpoint
UPDATE "assets" a
   SET "retouched_from_asset_id" = sub.source,
       "trademark_scan_state"    = 'replacement'
  FROM (
    SELECT id, split_part(elem, ':', 2) AS source
      FROM "assets", unnest("ai_suggested_fields") AS elem
     WHERE elem LIKE 'retouched\_from:%'
  ) AS sub
 WHERE a.id = sub.id
   AND a."retouched_from_asset_id" IS NULL
   AND EXISTS (SELECT 1 FROM "assets" t WHERE t.id = sub.source);--> statement-breakpoint
-- A row that was blocked and carries identified marks, but produced no
-- replacement, is `blocked` — NOT `refused`. The distinction matters: `refused`
-- asserts a retouch was attempted and failed, and nothing in the database
-- records that. Claiming it here would manufacture the very evidence whose
-- absence is the defect this migration exists to fix.
UPDATE "assets"
   SET "trademark_scan_state" = 'blocked',
       "trademark_marks"      = COALESCE("conflict_tags", '{}')
 WHERE "generation_allowed" IS FALSE
   AND "trademark_scan_state" IS NULL
   AND COALESCE(array_length("conflict_tags", 1), 0) > 0;--> statement-breakpoint
-- Timestamp only what the remediation genuinely touched. Everything else keeps
-- trademark_scan_state = NULL, which reads as "never scanned" and is the truth:
-- the scanner's 46 findings were never persisted, so most of the library has no
-- verdict at all. NULL here is an honest absence, not a gap to paper over.
UPDATE "assets"
   SET "trademark_scanned_at" = "updated_at"
 WHERE "trademark_scan_state" IS NOT NULL
   AND "trademark_scanned_at" IS NULL;