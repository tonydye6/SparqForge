-- 0043 · a take can be a shot.
--
-- Studio v2's clips are stage takes (payload {videoUrl, sourceImageUrl, ...}),
-- not creative_variants, so a sequence built in the Sequence tab had no honest
-- way to point at them: "generated" requires a variant, and borrowing
-- "upload" would lie about provenance. The new kind carries real lineage,
-- which is what cut staleness (build step 4) will read: a clip knows which
-- take it came from, so reopening upstream can mark the CUT stale instead of
-- silently re-rendering.

ALTER TABLE "sequence_clips" ADD COLUMN "source_take_id" text;--> statement-breakpoint

ALTER TABLE "sequence_clips" ADD CONSTRAINT "sequence_clips_source_take_id_stage_takes_id_fk"
  FOREIGN KEY ("source_take_id") REFERENCES "public"."stage_takes"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "sequence_clips" DROP CONSTRAINT "sequence_clips_source_kind_check";--> statement-breakpoint
ALTER TABLE "sequence_clips" ADD CONSTRAINT "sequence_clips_source_kind_check"
  CHECK ("source_kind" IN ('generated', 'library_asset', 'upload', 'studio_take'));--> statement-breakpoint

ALTER TABLE "sequence_clips" DROP CONSTRAINT "sequence_clips_source_present_check";--> statement-breakpoint
ALTER TABLE "sequence_clips" ADD CONSTRAINT "sequence_clips_source_present_check"
  CHECK ((source_kind = 'generated'     AND source_variant_id IS NOT NULL)
     OR (source_kind = 'library_asset' AND source_asset_id   IS NOT NULL)
     OR (source_kind = 'upload'        AND upload_url        IS NOT NULL)
     OR (source_kind = 'studio_take'   AND source_take_id    IS NOT NULL)
     OR source_missing_at IS NOT NULL);--> statement-breakpoint

-- The stamp trigger learns the new pointer, for the same reason it exists at
-- all: the FK's SET NULL fires with no application code in the loop.
CREATE OR REPLACE FUNCTION sequence_clips_mark_source_missing()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_missing_at IS NULL
     AND ((NEW.source_kind = 'generated'     AND NEW.source_variant_id IS NULL)
       OR (NEW.source_kind = 'library_asset' AND NEW.source_asset_id   IS NULL)
       OR (NEW.source_kind = 'upload'        AND NEW.upload_url        IS NULL)
       OR (NEW.source_kind = 'studio_take'   AND NEW.source_take_id    IS NULL))
  THEN
    NEW.source_missing_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
