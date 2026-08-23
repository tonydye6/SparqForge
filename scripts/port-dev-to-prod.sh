#!/usr/bin/env bash
# Port dev's assets + brands into PRODUCTION.
#
# Run this in a Replit Shell tab that was opened AFTER the PROD_DATABASE_URL
# secret was saved (secrets are only injected into new shells — an older shell
# reports an empty string, and psql with an empty connection string silently
# connects to the LOCAL dev database instead, which is how a "port" can quietly
# write to the wrong place).
#
#   bash port-dev-to-prod.sh
#
# WHY AN UPSERT AND NOT A REPLACE. RE-MEASURED 2026-08-23 against the live prod
# API and the dev database: prod has 155 assets (0 archived, so that is the real
# row count), dev has 445, and 154 ids are common to both. So ON CONFLICT (id) DO
# UPDATE refreshes the 154 stale rows, inserts the 291 dev-only ones, and leaves
# the one prod-only row alone -- still sparq_logo_skull-wordmark_white.png
# (7f1a6141-3c48-49ad-b1d7-3306e41e7250). Prod ends at 446. Nothing is deleted,
# so no foreign key from creatives, creative_variants or asset_pairings can break.
#
# Prod fell from 165 rows (2026-08-12) to 155 without any archiving, and the one
# prod-only row survived, so the ten that went were rows dev also has: the upsert
# puts every one of them back. The cause is still unknown -- see the audit query
# printed at the end of this script.
#
# WHAT THIS FIXES, MEASURED THE SAME DAY: prod has 1 asset with
# generation_allowed=false where dev has 75, and ZERO trademark_scan_state where
# dev has 303 verdicts. crownu_char_female_blue_tennis_default.jpeg is
# generation_allowed=true AND status=approved in production right now.
#
# TWO HAZARDS THIS HANDLES:
#  1. assets.retouched_to_asset_id / retouched_from_asset_id are SELF-references
#     (38 and 27 rows set — the trademark remediation links). Inserting them in
#     one pass can reference a row that has not been inserted yet, so they go in
#     as NULL and are filled by a second UPDATE once every row exists.
#  2. brands.default_persona_id points at designer_personas, and prod's personas
#     were created through the API so they have DIFFERENT ids from dev's. That
#     column is therefore EXCLUDED from the brand upsert — prod keeps its own.
set -euo pipefail

if [ -z "${PROD_DATABASE_URL:-}" ]; then
  echo "PROD_DATABASE_URL is empty. Open a NEW Shell tab (secrets are only injected into new shells) and re-run." >&2
  exit 1
fi

cd ~/portbak 2>/dev/null || { mkdir -p ~/portbak && cd ~/portbak; }

echo "== identity check =="
psql "$PROD_DATABASE_URL" -A -t -c "select 'PROD assets='||count(*) from assets"
psql "$DATABASE_URL"      -A -t -c "select 'DEV  assets='||count(*) from assets"

echo "== backup (prod assets + brands) =="
pg_dump "$PROD_DATABASE_URL" -t assets -t brands --data-only --column-inserts \
  > "prod_backup_$(date +%Y%m%d_%H%M%S).sql"
ls -la prod_backup_*.sql | tail -1

echo "== build column lists from the live dev schema =="
Q="select string_agg(%s, ', ' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='%s'%s"
COLS=$(psql "$DATABASE_URL" -A -t -c "$(printf "$Q" "quote_ident(column_name)" assets "")")
SETS=$(psql "$DATABASE_URL" -A -t -c "$(printf "$Q" "quote_ident(column_name)||' = excluded.'||quote_ident(column_name)" assets " and column_name not in ('id','retouched_to_asset_id','retouched_from_asset_id')")")
SEL=$(psql "$DATABASE_URL" -A -t -c "$(printf "$Q" "case when column_name in ('retouched_to_asset_id','retouched_from_asset_id') then 'NULL::text' else quote_ident(column_name) end" assets "")")
BCOLS=$(psql "$DATABASE_URL" -A -t -c "$(printf "$Q" "quote_ident(column_name)" brands "")")
BSETS=$(psql "$DATABASE_URL" -A -t -c "$(printf "$Q" "quote_ident(column_name)||' = excluded.'||quote_ident(column_name)" brands " and column_name not in ('id','default_persona_id')")")

echo "== export dev rows =="
psql "$DATABASE_URL" -c "\copy (select * from assets) to '/tmp/dev_assets.csv' with (format csv)"
psql "$DATABASE_URL" -c "\copy (select * from brands) to '/tmp/dev_brands.csv' with (format csv)"

echo "== upsert into production (single transaction) =="
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
CREATE TEMP TABLE s_assets (LIKE assets);
\copy s_assets FROM '/tmp/dev_assets.csv' with (format csv)
CREATE TEMP TABLE s_brands (LIKE brands);
\copy s_brands FROM '/tmp/dev_brands.csv' with (format csv)

INSERT INTO assets ($COLS) SELECT $SEL FROM s_assets
  ON CONFLICT (id) DO UPDATE SET $SETS;

UPDATE assets a
   SET retouched_to_asset_id   = s.retouched_to_asset_id,
       retouched_from_asset_id = s.retouched_from_asset_id
  FROM s_assets s WHERE a.id = s.id;

INSERT INTO brands ($BCOLS) SELECT $BCOLS FROM s_brands
  ON CONFLICT (id) DO UPDATE SET $BSETS;
COMMIT;
SQL

echo "== verify by content =="
psql "$PROD_DATABASE_URL" -A -t -c "
select 'assets='||count(*)
     ||' classified='||count(*) filter (where asset_class is not null)
     ||' analyzed='||count(*) filter (where ai_analyzed_at is not null)
     ||' blocked='||count(*) filter (where generation_allowed is false)
     ||' tm_scanned='||count(*) filter (where trademark_scan_state is not null)
  from assets"
psql "$DATABASE_URL" -A -t -c "
select 'DEV     '||count(*)
     ||' classified='||count(*) filter (where asset_class is not null)
     ||' analyzed='||count(*) filter (where ai_analyzed_at is not null)
     ||' blocked='||count(*) filter (where generation_allowed is false)
     ||' tm_scanned='||count(*) filter (where trademark_scan_state is not null)
  from assets"
echo "-- brand colours in prod (Crown U should now be Victory Gold #FFD700):"
psql "$PROD_DATABASE_URL" -A -t -c "select name||' '||color_primary from brands order by name"

echo
echo "== who touched production, and when =="
# Prod went 165 -> 155 rows with nothing archived, and 18 assets were bulk-approved
# at 2026-08-23T22:14:05.644Z with approved_by NULL -- a combination the API cannot
# produce (routes/assets.ts only stamps approved_at when approved_by is supplied,
# and 18 PUTs cannot share one millisecond). So both were direct SQL. If either
# went through the app instead, these rows say so.
psql "$PROD_DATABASE_URL" -P pager=off -A -t -c "
select action, count(*), min(created_at), max(created_at)
  from audit_logs
 where entity_type = 'asset'
 group by action
 order by 4 desc"
