-- Say, retroactively, that the analyzer wrote the prose it wrote.
--
-- `analyzeAndStoreAsset` used to set `description` and `style_notes`
-- unconditionally on every run, and it never recorded either field in
-- `ai_suggested_fields` -- that array only ever named the nine intelligence
-- columns. So the database has no record of who authored the prose on any
-- asset analyzed before now.
--
-- That did not matter while the analyzer overwrote regardless. It matters
-- now: prose is provenance-gated, and `resolveNarrativeUpdates` refuses to
-- replace a value it cannot prove a machine wrote. Without this migration
-- every already-analyzed asset reads as HUMAN-authored and freezes -- 445
-- rows in dev, ~154 in production, all carrying machine prose that Analyze
-- would refuse to refresh. That is precisely the "metadata bar just displays
-- AI gibberish" complaint, made permanent by the fix meant to address it.
--
-- The claim is narrow on purpose. A row qualifies only if it was actually
-- analyzed (`ai_analyzed_at IS NOT NULL`), the column actually holds
-- something, and the field is not already listed. Anything typed by a curator
-- BEFORE its asset was ever analyzed is therefore also claimed here -- that is
-- unavoidable, because nothing in the schema distinguishes the two, and the
-- old code had already overwritten such a value on the first analysis run
-- anyway. Claiming it restores the pre-change behaviour for exactly those rows
-- rather than inventing a new one.
--
-- Idempotent: the `NOT (... = ANY(...))` guard makes a second run a no-op.
--
-- ⚠️ THIS ONE MUST BE RUN AGAINST PRODUCTION BY HAND. Replit's publish copies
-- dev's DDL and NOT a migration's data statements (see 0048's note and the
-- 2026-08-12 `assets_freshness_score_scale_check` failure). Production has its
-- own analyzed rows, so publishing this file changes nothing there until the
-- two UPDATEs below are run against `PROD_DATABASE_URL`. The prod SQL console
-- executes only the LAST statement of a multi-statement input -- run them one
-- at a time and check the row count of each.
UPDATE "assets"
   SET "ai_suggested_fields" = COALESCE("ai_suggested_fields", ARRAY[]::text[]) || ARRAY['description']::text[],
       "updated_at" = NOW()
 WHERE "ai_analyzed_at" IS NOT NULL
   AND COALESCE(BTRIM("description"), '') <> ''
   AND NOT ('description' = ANY(COALESCE("ai_suggested_fields", ARRAY[]::text[])));
--> statement-breakpoint
UPDATE "assets"
   SET "ai_suggested_fields" = COALESCE("ai_suggested_fields", ARRAY[]::text[]) || ARRAY['styleNotes']::text[],
       "updated_at" = NOW()
 WHERE "ai_analyzed_at" IS NOT NULL
   AND COALESCE(BTRIM("style_notes"), '') <> ''
   AND NOT ('styleNotes' = ANY(COALESCE("ai_suggested_fields", ARRAY[]::text[])));
