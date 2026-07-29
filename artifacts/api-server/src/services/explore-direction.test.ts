import { describe, it, expect } from "vitest";
import { collectExploreDirectionCases } from "./explore-direction.cases.js";

/** Directed-prompt assembly for stage 03, under vitest so Replit CI runs it. */
const cases = await collectExploreDirectionCases();

describe("explore direction", () => {
  it("has cases to run at all", () => {
    expect(cases.length).toBeGreaterThan(25);
  });
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
