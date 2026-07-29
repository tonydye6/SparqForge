import { describe, it, expect } from "vitest";
import { collectDirectionSpreadCases } from "./direction-spread.cases.js";

/**
 * The stage 02 designer spread, under vitest so CI runs it.
 *
 * The cases themselves live in direction-spread.cases.ts, shared with the tsx
 * runner that works on machines where vitest cannot start. See that file for why.
 *
 * Each case becomes its own named test rather than one big assertion, so a
 * failure report names the invariant that broke instead of just the file.
 */

const cases = collectDirectionSpreadCases();

describe("direction spread", () => {
  it("has cases to run at all", () => {
    // A silent zero would let a broken extraction look like a green suite.
    expect(cases.length).toBeGreaterThan(35);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
