-- Restore the one pre-existing LinkedIn connection that belonged to Crown U
-- before 0046 normalized every social account to the Sparq house brand.
--
-- The additional current-owner check makes this a narrowly scoped correction:
-- rows that have since been moved elsewhere are left untouched.
UPDATE "social_accounts" AS account
   SET "brand_id" = crown_u."id",
       "updated_at" = NOW()
  FROM (
    SELECT "id"
      FROM "brands"
     WHERE LOWER("slug") = 'crown-u'
     ORDER BY "created_at" ASC, "id" ASC
     LIMIT 1
  ) AS crown_u
 WHERE LOWER(account."platform") = 'linkedin'
   AND LOWER(account."account_name") = 'tony dye'
   AND EXISTS (
     SELECT 1
       FROM "brands" AS sparq
      WHERE sparq."id" = account."brand_id"
        AND LOWER(sparq."slug") = 'sparq'
   );
