import { describe, it, expect } from "vitest";
import { runCases } from "./gemini-key.cases.js";

describe("direct Google AI key resolution", () => {
  for (const c of runCases()) {
    it(c.name, () => expect(c.ok, c.detail).toBe(true));
  }
});
