import { describe, it, expect } from "vitest";
import { searchTokens, compactText, MAX_SEARCH_TOKENS } from "./asset-search.js";

/**
 * The client mirrors these two functions in components/studio/mentions.tsx and
 * narrows an in-flight page with them. These are the SAME cases its tests use:
 * if one side changes, the pair must change together, or the picker will offer
 * rows the server would not return (or hide rows it did).
 */
describe("searchTokens", () => {
  it("splits on anything that is not a letter or digit", () => {
    expect(searchTokens("Crown_U 3D-Logo.png")).toEqual(["crown", "u", "3d", "logo", "png"]);
  });

  it("yields no tokens for punctuation alone, so nothing is searched", () => {
    expect(searchTokens("   ")).toEqual([]);
    expect(searchTokens("__--__")).toEqual([]);
  });

  it("caps the word count so one pasted paragraph cannot fan out unbounded scans", () => {
    expect(searchTokens("a b c d e f g h i j k l")).toHaveLength(MAX_SEARCH_TOKENS);
  });

  it("emits only alphanumeric tokens, which is what makes them LIKE-safe", () => {
    // The route interpolates each token into a LIKE pattern; a surviving `%`
    // or `_` would be a wildcard rather than a literal.
    for (const token of searchTokens("100%_off; drop--table")) {
      expect(token).toMatch(/^[a-z0-9]+$/);
    }
  });
});

describe("compactText", () => {
  it("compacts both of the library's naming conventions to one shape", () => {
    expect(compactText("crownu_3d_logo")).toBe("crownu3dlogo");
    expect(compactText("Crown U 3D Logo")).toBe("crownu3dlogo");
  });

  it("is empty for input with nothing matchable in it", () => {
    expect(compactText("  -_- ")).toBe("");
  });
});

/**
 * The matching rule itself, exercised the way the SQL applies it: every token
 * must appear in the compacted name-plus-description.
 */
describe("the token rule the route applies", () => {
  const matches = (name: string, description: string | null, query: string) => {
    const tokens = searchTokens(query);
    if (tokens.length === 0) return false;
    const haystack = compactText(`${name} ${description ?? ""}`);
    return tokens.every((t) => haystack.includes(t));
  };

  it("finds an underscored asset from a phrase typed with spaces", () => {
    expect(matches("crownu_3d_logo", null, "Crown U logo")).toBe(true);
  });

  it("finds a spaced asset from a run-together phrase", () => {
    expect(matches("Crown U Logo", null, "crownu")).toBe(true);
  });

  it("matches a single word anywhere in the name", () => {
    expect(matches("Partner Logo Bengals", null, "logo")).toBe(true);
  });

  it("ignores word order", () => {
    expect(matches("Partner Logo Bengals", null, "bengals logo")).toBe(true);
  });

  it("narrows with each added word", () => {
    expect(matches("Partner Logo Bengals", null, "logo dolphins")).toBe(false);
  });

  it("matches on the description too", () => {
    expect(matches("asset_0417", "the dimensional crest", "dimensional crest")).toBe(true);
  });
});
