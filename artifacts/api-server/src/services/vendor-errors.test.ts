import { describe, it, expect } from "vitest";
import { runCases } from "./vendor-errors.cases.js";

describe("vendor configuration errors are named as such", () => {
  for (const c of runCases()) {
    it(c.name, () => expect(c.ok, c.detail).toBe(true));
  }
});
