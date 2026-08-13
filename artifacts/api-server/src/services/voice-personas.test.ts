import { describe, it, expect } from "vitest";
import { runCases } from "./voice-personas.cases.js";

describe("stage 04 voice personas", () => {
  for (const r of runCases()) {
    it(r.name, () => {
      expect(r.ok, `${r.name} — got ${JSON.stringify(r.detail)}`).toBe(true);
    });
  }
});
