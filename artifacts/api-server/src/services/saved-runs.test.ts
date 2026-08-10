import { describe, it, expect } from "vitest";
import { collectSavedRunCases } from "./saved-runs.cases.js";

/**
 * Saved runs and cross-brand fan-out, under vitest so CI runs it.
 *
 * The cases live in saved-runs.cases.ts, shared with the tsx runner. Each case
 * becomes its own named test, so a failure report names the invariant that
 * broke rather than just the file.
 */

const cases = collectSavedRunCases();

describe("saved runs · capture and replay", () => {
  it("has cases to run at all", () => {
    // A silent zero would let a broken extraction look like a green suite.
    expect(cases.length).toBeGreaterThan(25);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
