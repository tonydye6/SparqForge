import { describe, it, expect } from "vitest";
import { collectExplorePlanCases } from "./explore-plan.cases.js";

/**
 * The stage 03 Explore plan, under vitest so CI runs it.
 *
 * Cases live in explore-plan.cases.ts, shared with the tsx runner that works on
 * machines where vitest cannot start. See that file for why.
 */

const cases = collectExplorePlanCases();

describe("explore plan", () => {
  it("has cases to run at all", () => {
    expect(cases.length).toBeGreaterThan(50);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
