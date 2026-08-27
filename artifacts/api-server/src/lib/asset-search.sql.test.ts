import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import { searchTokens, compactText } from "./asset-search.js";

/**
 * There is no Postgres on a dev Mac, so the search SQL added to
 * `routes/assets.ts` cannot be executed here. This renders the same fragments
 * through drizzle's own dialect instead, which catches the failures that would
 * otherwise only appear in production: a malformed `regexp_replace`, a token
 * inlined into the statement instead of bound as a parameter, or a raw `DESC`
 * fragment drizzle refuses to place in ORDER BY.
 *
 * The columns are re-declared locally with the real names because importing
 * `@workspace/db` needs a DATABASE_URL. The fragments are otherwise built
 * exactly as the route builds them — keep them in step.
 */
const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
});

const SEARCHABLE_TEXT = sql`regexp_replace(lower(coalesce(${assets.name}, '') || ' ' || coalesce(${assets.description}, '')), '[^a-z0-9]+', '', 'g')`;
const SEARCHABLE_NAME = sql`regexp_replace(lower(coalesce(${assets.name}, '')), '[^a-z0-9]+', '', 'g')`;

const render = (fragment: ReturnType<typeof sql>) => new PgDialect().sqlToQuery(fragment);

describe("the search SQL", () => {
  it("normalizes name and description into one comparable string", () => {
    const { sql: text, params } = render(SEARCHABLE_TEXT);
    expect(text).toContain("regexp_replace");
    expect(text).toContain("'[^a-z0-9]+'");
    expect(text).toContain(`"assets"."name"`);
    expect(text).toContain(`"assets"."description"`);
    // The pattern and flags are literals in the statement, not bound values.
    expect(params).toEqual([]);
  });

  it("binds each typed token as a parameter rather than inlining it", () => {
    const tokens = searchTokens("Crown U logo");
    expect(tokens).toEqual(["crown", "u", "logo"]);

    for (const token of tokens) {
      const { sql: text, params } = render(sql`${SEARCHABLE_TEXT} LIKE ${`%${token}%`}`);
      expect(text).toContain("LIKE $1");
      expect(params).toEqual([`%${token}%`]);
      // The token itself must never appear in the statement text.
      expect(text).not.toContain(token);
    }
  });

  it("renders the relevance ordering fragments ORDER BY can take", () => {
    const compact = compactText("Crown U logo");
    expect(compact).toBe("crownulogo");

    const exact = render(sql`(${SEARCHABLE_NAME} = ${compact}) DESC`);
    expect(exact.sql).toMatch(/\) DESC$/);
    expect(exact.params).toEqual([compact]);

    const prefix = render(sql`(${SEARCHABLE_NAME} LIKE ${`${compact}%`}) DESC`);
    expect(prefix.params).toEqual([`${compact}%`]);

    const contains = render(sql`(${SEARCHABLE_NAME} LIKE ${`%${compact}%`}) DESC`);
    expect(contains.params).toEqual([`%${compact}%`]);
  });

  it("keeps a LIKE wildcard typed by the user as a literal, not a wildcard", () => {
    // `searchTokens` strips `%` and `_`, so a pasted pattern cannot widen the
    // search. This is the property the route relies on to skip escaping.
    expect(searchTokens("100%_off")).toEqual(["100", "off"]);
    const { params } = render(sql`${SEARCHABLE_TEXT} LIKE ${`%${searchTokens("100%_off")[0]}%`}`);
    expect(params).toEqual(["%100%"]);
  });
});
