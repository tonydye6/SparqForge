/**
 * Vitest wrapper. The assertions live in asset-retouch.cases.ts so the suite and
 * the tsx reporter can never drift apart.
 */
import { describe, it, expect } from "vitest";
import { collectAssetRetouchCases } from "./asset-retouch.cases.js";

describe("asset-retouch", () => {
  it("passes every rule", async () => {
    const results = await collectAssetRetouchCases();
    const failures = results.filter(r => !r.ok);
    expect(failures.map(f => `${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`)).toEqual([]);
    expect(results.length).toBeGreaterThan(30);
  });
});
