/**
 * Vitest wrapper. The assertions live in cost-recording.cases.ts so the suite
 * and the tsx reporter can never drift apart.
 */
import { describe, it, expect } from "vitest";
import { collectCostRecordingCases } from "./cost-recording.cases.js";

describe("cost-recording", () => {
  it("passes every rule", async () => {
    const results = await collectCostRecordingCases();
    const failures = results.filter(r => !r.ok);
    expect(failures.map(f => `${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`)).toEqual([]);
    // A floor, not a target: it only guards against the collector silently
    // returning nothing, which would make an empty suite look green.
    expect(results.length).toBeGreaterThan(40);
  });
});
