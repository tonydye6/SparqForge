ALTER TABLE "sequence_clips" DROP CONSTRAINT "sequence_clips_source_present_check";--> statement-breakpoint
ALTER TABLE "sequence_clips" ADD COLUMN "source_missing_at" timestamp;--> statement-breakpoint
ALTER TABLE "sequence_clips" ADD CONSTRAINT "sequence_clips_source_present_check" CHECK ((source_kind = 'generated'     AND source_variant_id IS NOT NULL)
     OR (source_kind = 'library_asset' AND source_asset_id   IS NOT NULL)
     OR (source_kind = 'upload'        AND upload_url        IS NOT NULL)
     OR source_missing_at IS NOT NULL);--> statement-breakpoint
-- The stamp that makes the relaxed CHECK above safe.
--
-- The foreign keys are ON DELETE SET NULL, so deleting a library asset or a
-- variant UPDATEs the clip to drop its pointer. No application code is in that
-- loop, which is why this is a trigger and not a service: a cascade fires
-- whoever did the delete, including a bulk library operation or psql.
--
-- Without it the relaxed CHECK would let a pointer go null with nothing
-- recording that it happened, which is the silent data loss this whole change
-- exists to prevent.
CREATE OR REPLACE FUNCTION sequence_clips_mark_source_missing()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_missing_at IS NULL
     AND ((NEW.source_kind = 'generated'     AND NEW.source_variant_id IS NULL)
       OR (NEW.source_kind = 'library_asset' AND NEW.source_asset_id   IS NULL)
       OR (NEW.source_kind = 'upload'        AND NEW.upload_url        IS NULL))
  THEN
    NEW.source_missing_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS sequence_clips_source_missing_trg ON sequence_clips;
--> statement-breakpoint
CREATE TRIGGER sequence_clips_source_missing_trg
BEFORE UPDATE ON sequence_clips
FOR EACH ROW EXECUTE FUNCTION sequence_clips_mark_source_missing();
