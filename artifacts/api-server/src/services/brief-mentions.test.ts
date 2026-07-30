import { describe, it, expect } from "vitest";
import { collectBriefMentionCases } from "./brief-mentions.cases.js";

/** Brief @ mention parsing and reconciliation, under vitest so Replit CI runs it. */
const cases = await collectBriefMentionCases();

describe("brief mentions", () => {
  it("has cases to run at all", () => {
    expect(cases.length).toBeGreaterThan(25);
  });
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(c.ok, `${c.name}${c.detail === undefined ? "" : ` · got ${JSON.stringify(c.detail)}`}`).toBe(true);
  });
});
