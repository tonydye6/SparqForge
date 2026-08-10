-- Verification for 0041 (one scale for the reference-quality scores).
--
-- Run it with:
--   docker exec -i sparqmake-pg psql -U postgres -d sparqmake -P pager=off \
--     < lib/db/verify/0041_one_scale.sql
--
-- Every SELECT is named for the answer it must give. The ERROR lines are the
-- expected refusals: the CHECKs must reject each scale that used to leak in.

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

\echo '=== 1. no dead zeros, no fractions, nothing out of range may remain ==='
SELECT count(*) AS should_be_0_zero_or_negative FROM assets
  WHERE subject_identity_score <= 0 OR style_strength_score <= 0 OR freshness_score <= 0;
SELECT count(*) AS should_be_0_fractional_below_1 FROM assets
  WHERE (subject_identity_score > 0 AND subject_identity_score < 1)
     OR (style_strength_score > 0 AND style_strength_score < 1)
     OR (freshness_score > 0 AND freshness_score < 1);
SELECT count(*) AS should_be_0_above_5 FROM assets
  WHERE subject_identity_score > 5 OR style_strength_score > 5 OR freshness_score > 5;

\echo '=== 1b. every classified asset must now carry all three scores ==='
SELECT count(*) AS should_be_0_classified_but_unscored FROM assets
  WHERE asset_class IN ('subject_reference', 'compositing', 'style_reference')
    AND (subject_identity_score IS NULL OR style_strength_score IS NULL OR freshness_score IS NULL);

\echo '=== 2. the CHECKs must refuse every scale that used to leak in ==='
INSERT INTO brands (id, name, slug) VALUES ('m41-brand', 'M41 Test', 'm41') ON CONFLICT (id) DO NOTHING;

\echo '   (next three INSERTs must each fail with a check-constraint ERROR)'
INSERT INTO assets (id, brand_id, type, name, uploaded_by, subject_identity_score)
  VALUES ('m41-a-zero', 'm41-brand', 'visual', 'm41 zero', 'm41-verify', 0);
INSERT INTO assets (id, brand_id, type, name, uploaded_by, subject_identity_score)
  VALUES ('m41-a-frac', 'm41-brand', 'visual', 'm41 fraction', 'm41-verify', 0.8);
INSERT INTO assets (id, brand_id, type, name, uploaded_by, freshness_score)
  VALUES ('m41-a-big', 'm41-brand', 'visual', 'm41 six', 'm41-verify', 6);
SELECT count(*) AS should_be_0_rejected_rows FROM assets WHERE id LIKE 'm41-a-%';

\echo '=== 3. the real scale and NULL must both still be writable ==='
INSERT INTO assets (id, brand_id, type, name, uploaded_by, subject_identity_score, style_strength_score, freshness_score)
  VALUES ('m41-a-ok', 'm41-brand', 'visual', 'm41 valid', 'm41-verify', 5, 1, 3);
INSERT INTO assets (id, brand_id, type, name, uploaded_by)
  VALUES ('m41-a-null', 'm41-brand', 'visual', 'm41 null', 'm41-verify');
SELECT count(*) AS should_be_2_accepted_rows FROM assets WHERE id LIKE 'm41-a-%';

-- Leave nothing behind.
DELETE FROM assets WHERE id LIKE 'm41-a-%';
DELETE FROM brands WHERE id = 'm41-brand';
SELECT count(*) AS should_be_0_leftovers FROM assets WHERE id LIKE 'm41-a-%';
