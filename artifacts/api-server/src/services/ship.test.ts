import { describe, it, expect } from "vitest";
import { collectShipCases } from "./ship.cases.js";

/**
 * ship invariants, under vitest so CI runs them.
 *
 * The cases live in ship.cases.ts, shared with the tsx runner. Each becomes
 * its own named test so a failure names the invariant, not the file.
 */

const cases = collectShipCases();

describe("ship", () => {
  it("has cases to run at all", () => {
    // A silent zero would let a broken extraction look like a green suite.
    expect(cases.length).toBeGreaterThan(30);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
