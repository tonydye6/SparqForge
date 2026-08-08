ALTER TABLE "cost_logs" ADD COLUMN "brand_id" text;--> statement-breakpoint
ALTER TABLE "cost_logs" ADD COLUMN "pricing_basis" text;--> statement-breakpoint
ALTER TABLE "cost_logs" ADD COLUMN "pass_type" text;--> statement-breakpoint
ALTER TABLE "cost_logs" ADD COLUMN "was_used" boolean;--> statement-breakpoint
ALTER TABLE "cost_logs" ADD CONSTRAINT "cost_logs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_logs_brand_created_at_idx" ON "cost_logs" USING btree ("brand_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "cost_logs" ADD CONSTRAINT "cost_logs_pricing_basis_check" CHECK ("cost_logs"."pricing_basis" IS NULL OR "cost_logs"."pricing_basis" IN ('measured_tokens', 'estimate_flat', 'estimate_from_bytes', 'reservation', 'pre_m2_estimate'));--> statement-breakpoint
ALTER TABLE "cost_logs" ADD CONSTRAINT "cost_logs_pass_type_check" CHECK ("cost_logs"."pass_type" IS NULL OR "cost_logs"."pass_type" IN ('preview', 'full'));--> statement-breakpoint
-- M2 one-time backfill. Hand-appended below the generated DDL: it touches data
-- only, so it does not affect 0030_snapshot.json and cannot cause meta drift.
--
-- Pre-M2 rows are ESTIMATES and the basis is not recoverable. Every writer used
-- a flat COST_ESTIMATES constant or a byte-size guess, and only one of ~20
-- (taste-distillation) recorded real token usage — but it wrote the same flat
-- constant regardless, so even those rows cannot be called measured. Labelling
-- them `pre_m2_estimate` says exactly that, rather than backdating a confidence
-- the data never had.
UPDATE "cost_logs"
   SET "pricing_basis" = CASE
         WHEN "operation" = 'budget_reservation' THEN 'reservation'
         ELSE 'pre_m2_estimate'
       END
 WHERE "pricing_basis" IS NULL;--> statement-breakpoint
-- Brand attribution IS recoverable for rows whose creative still exists. Rows
-- whose creative was deleted keep brand_id NULL and stay unattributable — that
-- history is genuinely lost, and inventing a brand for them would be worse than
-- leaving the gap visible. `was_used` and `pass_type` are deliberately NOT
-- backfilled: no pre-M2 row came from a two-pass flow, and NULL already means
-- "not part of one".
UPDATE "cost_logs" AS cl
   SET "brand_id" = c."brand_id"
  FROM "creatives" AS c
 WHERE cl."creative_id" = c."id"
   AND cl."brand_id" IS NULL;