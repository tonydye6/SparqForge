CREATE TABLE "performance_conclusions" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"kind" text NOT NULL,
	"statement" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"confidence" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"applies_to" jsonb,
	"applied_at" timestamp,
	"applied_by" text,
	"dismissed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "performance_conclusions_kind_check" CHECK ("performance_conclusions"."kind" IN ('persona', 'composition', 'window', 'disagreement')),
	CONSTRAINT "performance_conclusions_status_check" CHECK ("performance_conclusions"."status" IN ('proposed', 'applied', 'dismissed')),
	CONSTRAINT "performance_conclusions_confidence_check" CHECK ("performance_conclusions"."confidence" IN ('low', 'medium', 'high')),
	CONSTRAINT "performance_conclusions_evidence_n_check" CHECK (("performance_conclusions"."evidence" -> 'n') IS NOT NULL
        AND jsonb_typeof("performance_conclusions"."evidence" -> 'n') = 'number'
        AND ("performance_conclusions"."evidence" ->> 'n')::numeric > 0),
	CONSTRAINT "performance_conclusions_decision_provenance_check" CHECK (("performance_conclusions"."status" = 'applied'   AND "performance_conclusions"."applied_at" IS NOT NULL AND "performance_conclusions"."dismissed_at" IS NULL)
     OR ("performance_conclusions"."status" = 'dismissed' AND "performance_conclusions"."dismissed_at" IS NOT NULL AND "performance_conclusions"."applied_at" IS NULL)
     OR ("performance_conclusions"."status" = 'proposed'  AND "performance_conclusions"."applied_at" IS NULL AND "performance_conclusions"."dismissed_at" IS NULL)),
	CONSTRAINT "performance_conclusions_applied_has_target_check" CHECK ("performance_conclusions"."status" <> 'applied' OR "performance_conclusions"."applies_to" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "performance_conclusions" ADD CONSTRAINT "performance_conclusions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_conclusions" ADD CONSTRAINT "performance_conclusions_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "performance_conclusions_brand_status_idx" ON "performance_conclusions" USING btree ("brand_id","status","created_at" DESC NULLS LAST);