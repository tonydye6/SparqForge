/**
 * Vitest wrapper. The assertions live in performance-learning.cases.ts so the
 * suite and the tsx reporter can never drift apart.
 */
import { describe, it, expect } from "vitest";
import { collectPerformanceLearningCases } from "./performance-learning.cases.js";

describe("performance-learning", () => {
  it("passes every rule", async () => {
    const results = await collectPerformanceLearningCases();
    const failures = results.filter(r => !r.ok);
    expect(failures.map(f => `${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`)).toEqual([]);
    expect(results.length).toBeGreaterThan(50);
  });
});
