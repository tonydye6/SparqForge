import { describe, it, expect } from "vitest";
import { collectRegionEditCases } from "./region-edit.cases.js";

/** Region geometry and the drift report, under vitest so CI runs them. */
const cases = collectRegionEditCases();

describe("region edit", () => {
  it("has cases to run at all", () => {
    expect(cases.length).toBeGreaterThan(40);
  });
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
