-- Abandon 0047. Every social account belongs to the Sparq house brand.
--
-- Tony's call, 2026-08-23. 0046 normalized every account to the house brand;
-- 0047 then moved the one Crown U LinkedIn back. That left code and data
-- disagreeing, because `resolveConnectBrandId` (routes/social-auth.ts) ignores
-- any incoming brandId and resolves the house brand, and `upsertSocialAccount`
-- writes `brandId: excluded.brand_id` on conflict -- so the next reconnect of
-- that LinkedIn would have silently undone 0047 anyway. Rather than teach the
-- reconnect path to preserve an owner (which would reintroduce the per-brand
-- model doc 38 §3 removed), the data now matches the code.
--
-- Nothing user-facing reads `brand_id` on an account any more: the Brand page's
-- Platforms tab used to filter by it and no longer does, and `resolveChannels`
-- only ever used it to rank the post's own brand first. The column stays NOT
-- NULL, so the house brand's id remains the honest way to say "the workspace".
--
-- Same body as 0046, deliberately: it is idempotent, it is not specific to the
-- row 0047 touched, and re-running the general rule is what makes this durable.
--
-- NOTE: this will never run on production. Replit's publish copies dev's DDL
-- and not a migration's data statements. Production currently has ZERO
-- connected social accounts, so there is nothing there to normalize; whatever
-- is connected there later goes in as house-brand via the connect route.
UPDATE "social_accounts" AS account
   SET "brand_id" = house."id",
       "updated_at" = NOW()
  FROM (
    SELECT "id"
      FROM "brands"
     WHERE LOWER("slug") = 'sparq'
     ORDER BY "created_at" ASC, "id" ASC
     LIMIT 1
  ) AS house
 WHERE account."brand_id" IS DISTINCT FROM house."id";
