-- 0042 · a mode target is not a pick.
--
-- Entering stage 03's Refine used to record its target as a CURRENT take in
-- the "selected" slot with payload {slotKey} and NO imageUrl. Everything that
-- reads the selected slot as "the pick" — the ship bar, the publish checks,
-- the Smart Bar's take_picked event — then saw a pick with no picture: one
-- click on "Refine" walked a shipped post back to "cannot publish"
-- (doc 40 P0.1, caught live on the deployed build).
--
-- The target moves to stage_states.mode_slot_key. This migration adds the
-- column, backfills it for stages sitting in refine mode, and repairs the
-- damage pattern: pointer takes (selected, current, no imageUrl) are demoted,
-- and where that leaves a stage with no current pick, the newest selected
-- take that actually carries an image is promoted back.

ALTER TABLE stage_states ADD COLUMN mode_slot_key text;--> statement-breakpoint

UPDATE stage_states s SET mode_slot_key = (
  SELECT t.payload->>'slotKey'
  FROM stage_takes t
  WHERE t.stage_state_id = s.id
    AND t.slot_key = 'selected'
    AND t.payload->>'imageUrl' IS NULL
  ORDER BY t.take_index DESC
  LIMIT 1
)
WHERE s.mode = 'refine';--> statement-breakpoint

UPDATE stage_takes SET is_current = false
WHERE slot_key = 'selected'
  AND is_current
  AND payload->>'imageUrl' IS NULL;--> statement-breakpoint

UPDATE stage_takes SET is_current = true
FROM (
  SELECT DISTINCT ON (stage_state_id) id
  FROM stage_takes
  WHERE slot_key = 'selected' AND payload->>'imageUrl' IS NOT NULL
  ORDER BY stage_state_id, take_index DESC
) newest
WHERE stage_takes.id = newest.id
  AND NOT EXISTS (
    SELECT 1 FROM stage_takes c
    WHERE c.stage_state_id = stage_takes.stage_state_id
      AND c.slot_key = 'selected'
      AND c.is_current
  );
