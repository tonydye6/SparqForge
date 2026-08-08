import { describe, it, expect } from "vitest";
import { collectIdentityCheckCases } from "./identity-check.cases.js";
describe("identity-check", () => {
  it("passes every rule", async () => {
    const results = await collectIdentityCheckCases();
    expect(results.filter(r => !r.ok).map(f => f.name)).toEqual([]);
    expect(results.length).toBeGreaterThan(30);
  });
});
