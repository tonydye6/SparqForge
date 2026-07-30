import { describe, it, expect } from "vitest";
import { collectCopyStageCases } from "./copy-stage.cases.js";

/** Stage 04 Copy rules, under vitest so Replit CI runs them. */
const cases = await collectCopyStageCases();

describe("copy stage", () => {
  it("has cases to run at all", () => {
    expect(cases.length).toBeGreaterThan(30);
  });
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
