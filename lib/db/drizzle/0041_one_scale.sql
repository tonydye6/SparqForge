-- 0041 · one scale for the reference-quality scores.
--
-- subject_identity_score, style_strength_score and freshness_score are read
-- everywhere as 1–5 (asset-policy's ranking, packet assembly, the backfill
-- priors, the analysis prompt, the /metadata validation) — but three writers
-- put three different scales into them:
--
--   · an early import wrote literal 0s ("no value"), which the ranking then
--     read as ((0-1)/4)*1.5 = a PENALTY on exactly the analyzed subject refs;
--   · asset-analysis divided the model's 1–5 by 5, storing 0.2–1.0 — a
--     perfect-identity 5 became 1.0 and ranked as bottom-of-scale;
--   · the Asset Library editor round-tripped through the same /5.
--
-- Mapping, chosen against the live histograms of BOTH databases (Mac: all
-- NULL; Replit dev: {0, 0.6, 0.8, 1, 2, 3, 4} and nothing else):
--   0        → NULL          (dead import value; unknown, not "worst")
--   (0, 1]   → round(v * 5)  (the /5 writers; 1.0 provably means 5 — every
--                             live 1.0 is ai-suggested, i.e. analysis-written)
--   (1, 5]   → round(v)      (already on the real scale)
-- The CHECKs then make a fourth scale impossible to write.

UPDATE assets SET subject_identity_score = NULL WHERE subject_identity_score <= 0;--> statement-breakpoint
UPDATE assets SET subject_identity_score = LEAST(5, GREATEST(1, ROUND(subject_identity_score * 5))) WHERE subject_identity_score > 0 AND subject_identity_score <= 1;--> statement-breakpoint
UPDATE assets SET subject_identity_score = LEAST(5, ROUND(subject_identity_score)) WHERE subject_identity_score > 1;--> statement-breakpoint

UPDATE assets SET style_strength_score = NULL WHERE style_strength_score <= 0;--> statement-breakpoint
UPDATE assets SET style_strength_score = LEAST(5, GREATEST(1, ROUND(style_strength_score * 5))) WHERE style_strength_score > 0 AND style_strength_score <= 1;--> statement-breakpoint
UPDATE assets SET style_strength_score = LEAST(5, ROUND(style_strength_score)) WHERE style_strength_score > 1;--> statement-breakpoint

UPDATE assets SET freshness_score = NULL WHERE freshness_score <= 0;--> statement-breakpoint
UPDATE assets SET freshness_score = LEAST(5, GREATEST(1, ROUND(freshness_score * 5))) WHERE freshness_score > 0 AND freshness_score <= 1;--> statement-breakpoint
UPDATE assets SET freshness_score = LEAST(5, ROUND(freshness_score)) WHERE freshness_score > 1;--> statement-breakpoint

ALTER TABLE assets ADD CONSTRAINT assets_subject_identity_score_scale_check CHECK (subject_identity_score IS NULL OR (subject_identity_score >= 1 AND subject_identity_score <= 5));--> statement-breakpoint
ALTER TABLE assets ADD CONSTRAINT assets_style_strength_score_scale_check CHECK (style_strength_score IS NULL OR (style_strength_score >= 1 AND style_strength_score <= 5));--> statement-breakpoint
ALTER TABLE assets ADD CONSTRAINT assets_freshness_score_scale_check CHECK (freshness_score IS NULL OR (freshness_score >= 1 AND freshness_score <= 5));--> statement-breakpoint

-- Doc 24 §6's "populate it, or delete it", decided: populate, with the same
-- class priors the backfill service has always declared (subject 4/2/3,
-- compositing 5/1/3, style 2/4/3) — but ONLY the score columns, only where
-- NULL, and MARKED ai-suggested so a later real analysis may overwrite them
-- (the analysis writer refuses to touch an unmarked human value). Running the
-- backfill endpoint instead was rejected: it also reclassifies by filename
-- heuristics and flips generationAllowed, and it leaves its writes unmarked,
-- locking real analysis out. Unclassified rows get no prior: no class, no
-- basis for one.
UPDATE assets SET
  subject_identity_score = COALESCE(subject_identity_score, CASE asset_class WHEN 'subject_reference' THEN 4 WHEN 'compositing' THEN 5 WHEN 'style_reference' THEN 2 END),
  style_strength_score   = COALESCE(style_strength_score,   CASE asset_class WHEN 'subject_reference' THEN 2 WHEN 'compositing' THEN 1 WHEN 'style_reference' THEN 4 END),
  freshness_score        = COALESCE(freshness_score,        CASE asset_class WHEN 'subject_reference' THEN 3 WHEN 'compositing' THEN 3 WHEN 'style_reference' THEN 3 END),
  ai_suggested_fields = (
    SELECT ARRAY(SELECT DISTINCT f FROM unnest(
      COALESCE(ai_suggested_fields, '{}') ||
      CASE WHEN subject_identity_score IS NULL THEN ARRAY['subjectIdentityScore'] ELSE '{}'::text[] END ||
      CASE WHEN style_strength_score IS NULL THEN ARRAY['styleStrengthScore'] ELSE '{}'::text[] END ||
      CASE WHEN freshness_score IS NULL THEN ARRAY['freshnessScore'] ELSE '{}'::text[] END
    ) AS f)
  )
WHERE asset_class IN ('subject_reference', 'compositing', 'style_reference')
  AND (subject_identity_score IS NULL OR style_strength_score IS NULL OR freshness_score IS NULL);
