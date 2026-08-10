import { describe, it, expect } from "vitest";
import { collectPublishFailureCases } from "./publish-failures.cases.js";

/**
 * Typed publish failures, under vitest so CI runs them.
 *
 * The cases live in publish-failures.cases.ts, shared with the tsx runner. Each
 * becomes its own named test so a failure names the invariant, not the file.
 */

const cases = collectPublishFailureCases();

describe("publish failures · classification and grouping", () => {
  it("has cases to run at all", () => {
    // A silent zero would let a broken extraction look like a green suite.
    expect(cases.length).toBeGreaterThan(35);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
