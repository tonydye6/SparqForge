import { describe, it, expect } from "vitest";
import { collectBrandCompletenessCases } from "./brand-completeness.cases.js";

/** Phase 5 brand-record completeness and provenance, under vitest for CI. */
const cases = await collectBrandCompletenessCases();

describe("brand completeness", () => {
  it("has cases to run at all", () => {
    expect(cases.length).toBeGreaterThan(25);
  });
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
