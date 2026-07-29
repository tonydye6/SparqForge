import { describe, it, expect } from "vitest";
import { collectExploreRunCases } from "./explore-run.cases.js";

/** The Explore run's money and partial-failure rules, under vitest so CI runs them. */
const cases = await collectExploreRunCases();

describe("explore run", () => {
  it("has cases to run at all", () => {
    expect(cases.length).toBeGreaterThan(15);
  });
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
