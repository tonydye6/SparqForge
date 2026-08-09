import { describe, it, expect } from "vitest";
import { runCases } from "./media-pair.cases.js";

// The same assertions the .verify.ts runner uses, so the suite and the
// standalone reporter can never drift apart.
describe("media pair", () => {
  for (const result of runCases()) {
    it(result.name, () => {
      expect(result.ok, JSON.stringify(result.detail)).toBe(true);
    });
  }
});
