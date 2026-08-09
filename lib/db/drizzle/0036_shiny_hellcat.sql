CREATE TABLE "audio_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_id" text,
	"variant_id" text,
	"track_kind" text NOT NULL,
	"source" text NOT NULL,
	"audio_url" text,
	"start_ms" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"gain_db" real DEFAULT 0 NOT NULL,
	"duck_under" text,
	"duck_amount_db" real DEFAULT -12,
	"script_take_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "audio_tracks_kind_check" CHECK ("track_kind" IN ('voice', 'music', 'sfx', 'native')),
	CONSTRAINT "audio_tracks_source_check" CHECK ("source" IN ('elevenlabs_tts', 'elevenlabs_music', 'elevenlabs_sfx', 'veo_native', 'upload')),
	CONSTRAINT "audio_tracks_duck_under_check" CHECK (duck_under IS NULL OR "duck_under" IN ('voice', 'music', 'sfx', 'native')),
	CONSTRAINT "audio_tracks_owner_check" CHECK ((sequence_id IS NOT NULL AND variant_id IS NULL)
     OR (sequence_id IS NULL AND variant_id IS NOT NULL)),
	CONSTRAINT "audio_tracks_start_check" CHECK (start_ms >= 0),
	CONSTRAINT "audio_tracks_duck_amount_check" CHECK (duck_amount_db IS NULL OR duck_amount_db <= 0)
);
--> statement-breakpoint
CREATE TABLE "sequence_clips" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_id" text NOT NULL,
	"position" integer NOT NULL,
	"source_kind" text NOT NULL,
	"source_variant_id" text,
	"source_asset_id" text,
	"upload_url" text,
	"trim_start_ms" integer DEFAULT 0 NOT NULL,
	"trim_end_ms" integer NOT NULL,
	"transition_in" text DEFAULT 'cut' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sequence_clips_position_uq" UNIQUE("sequence_id","position"),
	CONSTRAINT "sequence_clips_source_kind_check" CHECK ("source_kind" IN ('generated', 'library_asset', 'upload')),
	CONSTRAINT "sequence_clips_transition_check" CHECK ("transition_in" IN ('cut', 'dissolve')),
	CONSTRAINT "sequence_clips_source_present_check" CHECK ((source_kind = 'generated'     AND source_variant_id IS NOT NULL)
     OR (source_kind = 'library_asset' AND source_asset_id   IS NOT NULL)
     OR (source_kind = 'upload'        AND upload_url        IS NOT NULL)),
	CONSTRAINT "sequence_clips_trim_order_check" CHECK (trim_end_ms > trim_start_ms),
	CONSTRAINT "sequence_clips_trim_start_check" CHECK (trim_start_ms >= 0)
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" text PRIMARY KEY NOT NULL,
	"creative_id" text NOT NULL,
	"variant_id" text,
	"total_duration_ms" integer,
	"rendered_url" text,
	"render_status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sequences_render_status_check" CHECK ("render_status" IN ('draft', 'rendering', 'rendered', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_variant_id_creative_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."creative_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_script_take_id_stage_takes_id_fk" FOREIGN KEY ("script_take_id") REFERENCES "public"."stage_takes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_clips" ADD CONSTRAINT "sequence_clips_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_clips" ADD CONSTRAINT "sequence_clips_source_variant_id_creative_variants_id_fk" FOREIGN KEY ("source_variant_id") REFERENCES "public"."creative_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_clips" ADD CONSTRAINT "sequence_clips_source_asset_id_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_variant_id_creative_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."creative_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_tracks_sequence_idx" ON "audio_tracks" USING btree ("sequence_id");--> statement-breakpoint
CREATE INDEX "audio_tracks_variant_idx" ON "audio_tracks" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "sequences_creative_idx" ON "sequences" USING btree ("creative_id");