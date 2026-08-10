-- A clip may LOSE its source. It may not be born without one.
--
-- `0037` relaxed sequence_clips_source_present_check to allow a null pointer
-- while `source_missing_at` is set, which is what lets an asset be deleted
-- without either refusing the delete or destroying somebody's edit. That branch
-- is meant to be reachable only by the cascade: a row cannot have "lost"
-- something it never held.
--
-- Left open, a caller could INSERT a clip that is already broken and it would
-- pass the CHECK. No route does, but "no route does" is not a constraint.
CREATE OR REPLACE FUNCTION sequence_clips_reject_born_missing()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_missing_at IS NOT NULL THEN
    RAISE EXCEPTION
      'a clip cannot be created already missing its source (sequence_clips.source_missing_at is set by the cascade, not by callers)'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'sequence_clips_born_intact';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS sequence_clips_born_intact_trg ON sequence_clips;
--> statement-breakpoint
CREATE TRIGGER sequence_clips_born_intact_trg
BEFORE INSERT ON sequence_clips
FOR EACH ROW EXECUTE FUNCTION sequence_clips_reject_born_missing();
