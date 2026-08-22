import { describe, it, expect } from "vitest";
import {
  accountPlatformFor,
  ACCOUNT_PLATFORM_MAP,
  publishingAccountFor,
  workspaceAccountPlatforms,
} from "./platform-accounts.js";

describe("accountPlatformFor", () => {
  it("routes both Instagram surfaces to the single instagram account", () => {
    expect(accountPlatformFor("instagram_feed")).toBe("instagram");
    expect(accountPlatformFor("instagram_story")).toBe("instagram");
  });

  it("maps every other supported platform to itself", () => {
    expect(accountPlatformFor("twitter")).toBe("twitter");
    expect(accountPlatformFor("linkedin")).toBe("linkedin");
    expect(accountPlatformFor("tiktok")).toBe("tiktok");
    expect(accountPlatformFor("youtube")).toBe("youtube");
  });

  it("passes an unknown platform through unchanged", () => {
    expect(accountPlatformFor("threads")).toBe("threads");
  });

  it("covers every platform a calendar entry can carry", () => {
    // If a new platform ships without an entry here, entry-creation paths would
    // resolve no account and the publisher would reject the post permanently.
    expect(Object.keys(ACCOUNT_PLATFORM_MAP).sort()).toEqual([
      "instagram_feed",
      "instagram_story",
      "linkedin",
      "tiktok",
      "twitter",
      "youtube",
    ]);
  });
});

describe("publishingAccountFor", () => {
  const accounts = [
    { id: "house-ig", platform: "instagram", brandId: "brand-sparq" },
    { id: "house-yt", platform: "youtube", brandId: "brand-sparq" },
    { id: "crown-ig", platform: "instagram", brandId: "brand-crown" },
  ];

  it("uses a house account for a sub-brand with no account of its own", () => {
    expect(publishingAccountFor(accounts, "instagram_story", "brand-rumble")?.id).toBe("house-ig");
  });

  it("prefers a future brand-owned account when one exists", () => {
    expect(publishingAccountFor(accounts, "instagram_feed", "brand-crown")?.id).toBe("crown-ig");
  });

  it("returns no account when the workspace cannot publish that platform", () => {
    expect(publishingAccountFor(accounts, "tiktok", "brand-crown")).toBeUndefined();
  });
});

describe("workspaceAccountPlatforms", () => {
  it("deduplicates and ignores blank account platforms", () => {
    expect(workspaceAccountPlatforms([
      { platform: "instagram" },
      { platform: "instagram" },
      { platform: " " },
      { platform: "youtube" },
    ])).toEqual(["instagram", "youtube"]);
  });
});
