CREATE TABLE "stage_states" (
	"id" text PRIMARY KEY NOT NULL,
	"creative_id" text NOT NULL,
	"stage_number" integer NOT NULL,
	"stage_kind" text NOT NULL,
	"mode" text DEFAULT 'explore' NOT NULL,
	"status" text DEFAULT 'empty' NOT NULL,
	"locked_at" timestamp,
	"locked_by" text,
	"consumed_from" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp,
	"superseded_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stage_states_creative_stage_uq" UNIQUE("creative_id","stage_number")
);
--> statement-breakpoint
CREATE TABLE "stage_takes" (
	"id" text PRIMARY KEY NOT NULL,
	"stage_state_id" text NOT NULL,
	"slot_key" text NOT NULL,
	"take_index" integer NOT NULL,
	"origin" text DEFAULT 'generated' NOT NULL,
	"payload" jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"authored_by" text,
	"cost_cents" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- HAND-EDITED: IF NOT EXISTS added. Drizzle generated this line bare, which
-- would fail on any database where 0025 has already run.
--
-- 0025_asset_intelligence_provenance.sql was written by hand and already adds
-- this column, with its own IF NOT EXISTS guard, but it did not update the
-- drizzle meta snapshot. So the snapshot still believes the column is missing
-- and every subsequent generate re-emits it. Keeping the statement here (rather
-- than deleting it) is what finally heals that drift, because this migration's
-- snapshot does record the column, so future generates will stop re-adding it.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "ai_suggested_fields" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "stage_states" ADD CONSTRAINT "stage_states_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_states" ADD CONSTRAINT "stage_states_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_takes" ADD CONSTRAINT "stage_takes_stage_state_id_stage_states_id_fk" FOREIGN KEY ("stage_state_id") REFERENCES "public"."stage_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_takes" ADD CONSTRAINT "stage_takes_authored_by_users_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stage_states_creative_idx" ON "stage_states" USING btree ("creative_id","stage_number");--> statement-breakpoint
CREATE INDEX "stage_states_status_idx" ON "stage_states" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stage_takes_slot_idx" ON "stage_takes" USING btree ("stage_state_id","slot_key","take_index");--> statement-breakpoint
CREATE INDEX "stage_takes_current_idx" ON "stage_takes" USING btree ("stage_state_id","is_current");