import { describe, it, expect } from "vitest";
import { collectGuideExtractionCases } from "./guide-extraction.cases.js";

/** Brand-guide extraction: candidates, quotes and validation, under vitest for CI. */
const cases = await collectGuideExtractionCases();

describe("guide extraction", () => {
  it("has cases to run at all", () => {
    expect(cases.length).toBeGreaterThan(18);
  });
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
