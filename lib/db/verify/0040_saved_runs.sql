-- Verification for 0040 (M8 · saved runs).
--
-- The constraints in this migration are the kind that get believed rather than
-- tested, and doc 35 §5.4 is the reason not to: a cascade told me it silently
-- lost a clip and it had actually been failing the DELETE outright. So every
-- CHECK and both triggers are exercised here against a real database, with
-- throwaway brands so nothing real is ever at risk.
--
-- Run it with:
--   docker exec -i sparqmake-pg psql -U postgres -d sparqmake_v2 -P pager=off \
--     < lib/db/verify/0040_saved_runs.sql
--
-- Every SELECT is named for the answer it must give. Read the numbers, not the
-- absence of errors: the ERROR lines are the expected refusals.

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

-- Throwaway brands so the real ones are never at risk.
INSERT INTO brands (id, name, slug) VALUES ('m8-brand-a', 'M8 Test A', 'm8-a'), ('m8-brand-b', 'M8 Test B', 'm8-b');

\echo '=== 1. run with NO targets must be refused at COMMIT (deferred trigger) ==='
BEGIN;
INSERT INTO saved_runs (id, name, template_snapshot) VALUES ('m8-r1', 'no targets', '{"version":1,"sourceBrandId":null,"stages":[]}');
COMMIT;
SELECT count(*) AS should_be_0_r1 FROM saved_runs WHERE id = 'm8-r1';

\echo '=== 2. run + target in one transaction, either order, must succeed ==='
BEGIN;
INSERT INTO saved_run_brands (saved_run_id, brand_id) VALUES ('m8-r2', 'm8-brand-a');
COMMIT;
\echo '   (above must fail: FK to a run that does not exist yet outside a tx)'
BEGIN;
INSERT INTO saved_runs (id, name, template_snapshot) VALUES ('m8-r2', 'has a target', '{"version":1,"sourceBrandId":null,"stages":[]}');
INSERT INTO saved_run_brands (saved_run_id, brand_id) VALUES ('m8-r2', 'm8-brand-a');
COMMIT;
SELECT count(*) AS should_be_1_r2 FROM saved_runs WHERE id = 'm8-r2';

\echo '=== 3. run_count 0 with last_run_at set must be refused ==='
BEGIN;
INSERT INTO saved_runs (id, name, template_snapshot, run_count, last_run_at) VALUES ('m8-r3', 'lying row', '{"version":1}', 0, now());
COMMIT;
SELECT count(*) AS should_be_0_r3 FROM saved_runs WHERE id = 'm8-r3';

\echo '=== 4. run_count 3 with last_run_at null must be refused ==='
BEGIN;
INSERT INTO saved_runs (id, name, template_snapshot, run_count) VALUES ('m8-r4', 'other lying row', '{"version":1}', 3);
COMMIT;
SELECT count(*) AS should_be_0_r4 FROM saved_runs WHERE id = 'm8-r4';

\echo '=== 5. locked_stages as an object must be refused ==='
BEGIN;
INSERT INTO saved_runs (id, name, template_snapshot, locked_stages) VALUES ('m8-r5', 'bad stages', '{"version":1}', '{"a":1}');
COMMIT;
SELECT count(*) AS should_be_0_r5 FROM saved_runs WHERE id = 'm8-r5';

\echo '=== 6. blank name must be refused ==='
BEGIN;
INSERT INTO saved_runs (id, name, template_snapshot) VALUES ('m8-r6', '   ', '{"version":1}');
COMMIT;
SELECT count(*) AS should_be_0_r6 FROM saved_runs WHERE id = 'm8-r6';

\echo '=== 7. snapshot as an array must be refused ==='
BEGIN;
INSERT INTO saved_runs (id, name, template_snapshot) VALUES ('m8-r7', 'bad snapshot', '[]');
COMMIT;
SELECT count(*) AS should_be_0_r7 FROM saved_runs WHERE id = 'm8-r7';

\echo '=== 8. two-brand run: deleting ONE brand leaves the run alive ==='
BEGIN;
INSERT INTO saved_runs (id, name, template_snapshot) VALUES ('m8-r8', 'cross brand', '{"version":1,"sourceBrandId":null,"stages":[]}');
INSERT INTO saved_run_brands (saved_run_id, brand_id) VALUES ('m8-r8', 'm8-brand-a'), ('m8-r8', 'm8-brand-b');
COMMIT;
DELETE FROM brands WHERE id = 'm8-brand-b';
SELECT count(*) AS should_be_1_r8_run FROM saved_runs WHERE id = 'm8-r8';
SELECT count(*) AS should_be_1_r8_targets FROM saved_run_brands WHERE saved_run_id = 'm8-r8';

\echo '=== 9. deleting the LAST brand takes the run with it, and does NOT error ==='
DELETE FROM brands WHERE id = 'm8-brand-a';
SELECT count(*) AS should_be_0_r8_run FROM saved_runs WHERE id = 'm8-r8';
SELECT count(*) AS should_be_0_r2_run FROM saved_runs WHERE id = 'm8-r2';

\echo '=== 10. deleting the run itself cascades its targets with no recursion ==='
INSERT INTO brands (id, name, slug) VALUES ('m8-brand-c', 'M8 Test C', 'm8-c');
BEGIN;
INSERT INTO saved_runs (id, name, template_snapshot) VALUES ('m8-r10', 'delete me', '{"version":1,"sourceBrandId":null,"stages":[]}');
INSERT INTO saved_run_brands (saved_run_id, brand_id) VALUES ('m8-r10', 'm8-brand-c');
COMMIT;
DELETE FROM saved_runs WHERE id = 'm8-r10';
SELECT count(*) AS should_be_0_r10_targets FROM saved_run_brands WHERE saved_run_id = 'm8-r10';

\echo '=== 11. a run may be updated to a second brand and back down to one ==='
BEGIN;
INSERT INTO saved_runs (id, name, template_snapshot) VALUES ('m8-r11', 'grow and shrink', '{"version":1,"sourceBrandId":null,"stages":[]}');
INSERT INTO saved_run_brands (saved_run_id, brand_id) VALUES ('m8-r11', 'm8-brand-c');
COMMIT;
INSERT INTO brands (id, name, slug) VALUES ('m8-brand-d', 'M8 Test D', 'm8-d');
INSERT INTO saved_run_brands (saved_run_id, brand_id) VALUES ('m8-r11', 'm8-brand-d');
DELETE FROM saved_run_brands WHERE saved_run_id = 'm8-r11' AND brand_id = 'm8-brand-d';
SELECT count(*) AS should_be_1_r11_run FROM saved_runs WHERE id = 'm8-r11';
UPDATE saved_runs SET run_count = 1, last_run_at = now() WHERE id = 'm8-r11';
SELECT run_count AS should_be_1_r11_count FROM saved_runs WHERE id = 'm8-r11';

\echo '=== cleanup ==='
DELETE FROM brands WHERE id LIKE 'm8-brand-%';
SELECT count(*) AS should_be_0_leftover FROM saved_runs WHERE id LIKE 'm8-r%';
