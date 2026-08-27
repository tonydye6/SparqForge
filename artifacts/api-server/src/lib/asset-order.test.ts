import { describe, it, expect } from "vitest";
import { resolveAssetListOrder } from "./asset-order.js";

describe("resolveAssetListOrder", () => {
  it("gives the mention picker the newest assets first", () => {
    expect(resolveAssetListOrder("recent")).toBe("recent");
  });

  it("leaves every existing caller on the order it was written against", () => {
    // The Asset Library pages through this route and must not be reshuffled.
    expect(resolveAssetListOrder(undefined)).toBe("oldest");
    expect(resolveAssetListOrder("")).toBe("oldest");
    expect(resolveAssetListOrder("oldest")).toBe("oldest");
  });

  it("does not let a junk value silently reorder the library", () => {
    expect(resolveAssetListOrder("RECENT")).toBe("oldest");
    expect(resolveAssetListOrder(["recent"])).toBe("oldest");
    expect(resolveAssetListOrder(7)).toBe("oldest");
    expect(resolveAssetListOrder(null)).toBe("oldest");
  });
});
