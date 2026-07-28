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
	CONSTRAINT "stage_states_creative_stage_uq" UNIQUE("creative_id","stage_number"),
	CONSTRAINT "stage_states_number_range_check" CHECK ("stage_states"."stage_number" between 1 and 5),
	CONSTRAINT "stage_states_kind_check" CHECK ("stage_kind" in ('brief', 'direction', 'asset', 'copy', 'crops')),
	CONSTRAINT "stage_states_mode_check" CHECK ("mode" in ('explore', 'refine')),
	CONSTRAINT "stage_states_status_check" CHECK ("status" in ('empty', 'active', 'done', 'stale', 'locked')),
	CONSTRAINT "stage_states_number_kind_check" CHECK (("stage_number" = 1 and "stage_kind" = 'brief') or ("stage_number" = 2 and "stage_kind" = 'direction') or ("stage_number" = 3 and "stage_kind" = 'asset') or ("stage_number" = 4 and "stage_kind" = 'copy') or ("stage_number" = 5 and "stage_kind" = 'crops')),
	CONSTRAINT "stage_states_consumed_is_array_check" CHECK (jsonb_typeof("stage_states"."consumed_from") = 'array'),
	CONSTRAINT "stage_states_locked_provenance_check" CHECK (("stage_states"."status" <> 'locked') or ("stage_states"."locked_at" is not null))
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stage_takes_slot_take_uq" UNIQUE("stage_state_id","slot_key","take_index"),
	CONSTRAINT "stage_takes_origin_check" CHECK ("origin" in ('generated', 'region_edit', 'user_typed', 'swapped_in')),
	CONSTRAINT "stage_takes_index_positive_check" CHECK ("stage_takes"."take_index" >= 1)
);
--> statement-breakpoint
-- HAND-EDITED: IF NOT EXISTS added. Drizzle generated this line bare, which
-- would fail on any database where 0025 has already run.
--
-- 0025_asset_intelligence_provenance.sql was written by hand and already adds
-- this column, with its own IF NOT EXISTS guard, but it did not write a
-- 0025_snapshot.json. The meta directory jumps straight from 0024 to this file,
-- so the snapshot still believes the column is missing and every generate
-- re-emits it. Keeping the statement here rather than deleting it is what
-- finally heals the drift, because this migration's snapshot does record the
-- column, so future generates will stop re-adding it.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "ai_suggested_fields" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "stage_states" ADD CONSTRAINT "stage_states_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_states" ADD CONSTRAINT "stage_states_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_takes" ADD CONSTRAINT "stage_takes_stage_state_id_stage_states_id_fk" FOREIGN KEY ("stage_state_id") REFERENCES "public"."stage_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_takes" ADD CONSTRAINT "stage_takes_authored_by_users_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stage_states_creative_status_idx" ON "stage_states" USING btree ("creative_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_takes_one_current_per_slot_uq" ON "stage_takes" USING btree ("stage_state_id","slot_key") WHERE "stage_takes"."is_current";