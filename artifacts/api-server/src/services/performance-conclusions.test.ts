import { describe, it, expect } from "vitest";
import { runCases } from "./performance-conclusions.cases.js";

// The same assertions the .verify.ts runner uses, so the suite and the
// standalone reporter can never drift apart.
describe("performance conclusions", () => {
  for (const result of runCases()) {
    it(result.name, () => {
      expect(result.ok, JSON.stringify(result.detail)).toBe(true);
    });
  }
});
