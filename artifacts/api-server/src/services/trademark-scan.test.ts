import { describe, it, expect } from "vitest";
import { collectTrademarkScanCases } from "./trademark-scan.cases.js";

describe("trademark-scan", () => {
  it("holds every assertion", async () => {
    const failures = (await collectTrademarkScanCases()).filter(r => !r.ok);
    expect(failures, JSON.stringify(failures, null, 2)).toHaveLength(0);
  });
});
