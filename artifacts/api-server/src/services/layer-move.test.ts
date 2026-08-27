import { describe, it, expect } from "vitest";
import { runCases } from "./layer-move.cases.js";

describe("a layer move is compositing, so it lands exactly and keeps its size", async () => {
  for (const c of await runCases()) {
    it(c.name, () => expect(c.ok, c.detail).toBe(true));
  }
});
