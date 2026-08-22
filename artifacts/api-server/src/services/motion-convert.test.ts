import { describe, expect, it } from "vitest";
import { collectMotionConvertCases } from "./motion-convert.cases.js";

const cases = await collectMotionConvertCases();

describe("motion conversion settlement", () => {
  it("has cases to run", () => {
    expect(cases.length).toBeGreaterThan(7);
  });

  it.each(cases.map((entry) => [entry.name, entry] as const))(
    "%s",
    (_name, entry) => {
      expect(
        entry.ok,
        `${entry.name}${entry.detail === undefined ? "" : ` · got ${JSON.stringify(entry.detail)}`}`,
      ).toBe(true);
    },
  );
});
