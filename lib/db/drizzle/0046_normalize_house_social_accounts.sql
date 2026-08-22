-- Social accounts are connected once for the workspace and stored under the
-- Sparq house brand. Normalize legacy rows that were stamped with whichever
-- sub-brand page started OAuth. If the house brand is absent, this safely
-- updates nothing and the connect route refuses to invent another owner.
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
