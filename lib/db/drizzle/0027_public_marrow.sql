ALTER TABLE "brands" ADD COLUMN "sound_direction" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "narrator_voice_id" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "narrator_description" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "composition_rules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "brand_guide_file_url" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "completeness_score" integer;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "default_persona_id" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "default_spread_size" integer DEFAULT 8;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "monthly_budget_cents" integer;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_default_persona_id_designer_personas_id_fk" FOREIGN KEY ("default_persona_id") REFERENCES "public"."designer_personas"("id") ON DELETE set null ON UPDATE no action;