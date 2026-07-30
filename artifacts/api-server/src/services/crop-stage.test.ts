import { describe, it, expect } from "vitest";
import { collectCropStageCases } from "./crop-stage.cases.js";

/** Stage 05 crop geometry and platform-chrome rules, under vitest for CI. */
const cases = await collectCropStageCases();

describe("crop stage", () => {
  it("has cases to run at all", () => {
    expect(cases.length).toBeGreaterThan(25);
  });
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
