import { describe, it, expect } from "vitest";
import { GetAssetsQueryParams } from "@workspace/api-zod";
import { resolveAssetListOrder } from "../lib/asset-order.js";

/**
 * `GET /assets` drops EVERY filter — including `brandId` — when this parse
 * fails, because the whole filter block is guarded by `if (query.success)`. So
 * an unrecognised query param would not merely be ignored: it would silently
 * widen the mention picker to every brand's library.
 *
 * The picker now sends `limit` and `order` as well as `brandId`/`type`/`search`
 * (see the frontend's `assetSearchUrl` in components/studio/mentions.tsx), and
 * `order` is deliberately NOT part of the generated schema — it is read
 * straight off `req.query`. These fixtures mirror what the picker sends.
 */
const withSearch = {
  brandId: "crown-u",
  type: "visual",
  limit: "50",
  order: "recent",
  search: "CrownU 3D",
};

const withoutSearch = {
  brandId: "crown-u",
  type: "visual",
  limit: "50",
  order: "recent",
};

describe("the mention picker's query against GetAssetsQueryParams", () => {
  it("parses, so brand scoping survives", () => {
    const parsed = GetAssetsQueryParams.safeParse(withSearch);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.brandId).toBe("crown-u");
    expect(parsed.success && parsed.data.type).toBe("visual");
    expect(parsed.success && parsed.data.search).toBe("CrownU 3D");
  });

  it("parses with no search term, as when the user has only typed @", () => {
    const parsed = GetAssetsQueryParams.safeParse(withoutSearch);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.brandId).toBe("crown-u");
    expect(parsed.success && parsed.data.search).toBeUndefined();
  });

  it("reads newest-first off the same query the picker sends", () => {
    expect(resolveAssetListOrder(withSearch.order)).toBe("recent");
  });
});
