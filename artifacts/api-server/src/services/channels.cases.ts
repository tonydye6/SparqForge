/**
 * Channel-resolution cases, shared by the vitest suite and the tsx runner.
 *
 * Two invariants now. There is exactly ONE answer to "which channels is this
 * post for", grounded in the WORKSPACE's connected accounts rather than a list
 * somebody typed into a component. And the account each channel publishes
 * through is a CHOICE with a default, never an assumption: own-brand accounts
 * are preferred, house accounts serve everybody, and the picker's order and
 * the default can never disagree because they are the same array.
 */

import { resolveChannels, type AccountRef } from "./channels.js";

export interface Case {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const CROWN = "brand-crown";
const SPARQ = "brand-sparq";

/** The normalized workspace: every shared account is owned by the Sparq house brand. */
const WORKSPACE: AccountRef[] = [
  { id: "acct-sparq-ig", platform: "instagram", accountName: "@sparqgames", brandId: SPARQ },
  { id: "acct-sparq-tt", platform: "tiktok", accountName: "SPARQ", brandId: SPARQ },
  { id: "acct-sparq-yt", platform: "youtube", accountName: "Sparq Games", brandId: SPARQ },
  { id: "acct-sparq-li", platform: "linkedin", accountName: "Tony Dye", brandId: SPARQ },
];

export function collectChannelCases(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  {
    const out = resolveChannels([], CROWN);
    check("a workspace with no connected account has no channels", out.length === 0, out);
  }

  {
    // THE correction this file exists to hold: a brand with almost no accounts
    // of its own still publishes everywhere the workspace can.
    const out = resolveChannels(WORKSPACE, CROWN);
    const platforms = out.map((c) => c.platform);
    check(
      "a sub-brand with no own account still gets every workspace channel",
      JSON.stringify(platforms) === JSON.stringify(["instagram_feed", "instagram_story", "tiktok", "linkedin", "youtube"]),
      platforms,
    );
  }

  {
    const out = resolveChannels(WORKSPACE, CROWN);
    const li = out.find((c) => c.platform === "linkedin")!;
    const ig = out.find((c) => c.platform === "instagram_feed")!;
    check("a sub-brand defaults to the compatible house account", li.defaultAccountId === "acct-sparq-li", li);
    check("a channel with only house accounts defaults to the house one", ig.defaultAccountId === "acct-sparq-ig", ig);
    check(
      "the default is the picker's first entry, so they cannot disagree",
      out.every((c) => c.accounts[0]?.id === c.defaultAccountId),
      out.map((c) => [c.platform, c.defaultAccountId, c.accounts[0]?.id]),
    );
    check("house accounts are not mislabeled as sub-brand-owned", li.accounts[0]?.ownBrand === false && ig.accounts[0]?.ownBrand === false);
  }

  {
    // The future state: Crown U gains its own Instagram beside Sparq's.
    const later: AccountRef[] = [
      ...WORKSPACE,
      { id: "acct-crown-ig", platform: "instagram", accountName: "@crownu", brandId: CROWN },
    ];
    const ig = resolveChannels(later, CROWN).find((c) => c.platform === "instagram_feed")!;
    check("when a brand gains its own account, it becomes the default", ig.defaultAccountId === "acct-crown-ig", ig);
    check("and the house account is still offered", ig.accounts.some((a) => a.id === "acct-sparq-ig"), ig.accounts);
    const other = resolveChannels(later, "brand-rumble").find((c) => c.platform === "instagram_feed")!;
    check(
      "another brand still defaults to the house account, not Crown U's",
      other.defaultAccountId === "acct-sparq-ig",
      other,
    );
  }

  {
    const out = resolveChannels(WORKSPACE, CROWN);
    const feed = out.find((c) => c.platform === "instagram_feed")!;
    const story = out.find((c) => c.platform === "instagram_story")!;
    check(
      "one Instagram account serves both the feed and the story",
      feed.defaultAccountId === story.defaultAccountId,
      [feed.defaultAccountId, story.defaultAccountId],
    );
  }

  {
    const out = resolveChannels([{ id: "a", platform: "tiktok", accountName: "SPARQ", brandId: null }], null);
    check("a null brand id resolves cleanly, defaulting to the house account", out[0]?.defaultAccountId === "a", out);
    check("TikTok resolves to a 9:16 channel", out[0]?.aspectLabel === "9:16", out[0]);
    check("and it has real safe-area data", out[0]?.hasSafeAreas === true, out[0]);
  }

  {
    // The distinction that a warning depends on: mapped with nothing to dodge
    // is a verified fact, unmapped is an absence of knowledge.
    const feed = resolveChannels(WORKSPACE, CROWN).find((c) => c.platform === "instagram_feed");
    const linkedin = resolveChannels(WORKSPACE, CROWN).find((c) => c.platform === "linkedin");
    check(
      "a placement whose chrome sits outside the picture is mapped, with no safe areas",
      feed?.furnitureMapped === true && feed?.hasSafeAreas === false,
      feed,
    );
    check(
      "an unmapped placement is a different state entirely",
      linkedin?.furnitureMapped === false && linkedin?.hasSafeAreas === false,
      linkedin,
    );
    check("LinkedIn falls back to a square", linkedin?.aspectLabel === "1:1", linkedin);
    check("both still have copy limits", linkedin?.hasCopyRules === true && feed?.hasCopyRules === true);
  }

  {
    const dup = resolveChannels(
      [
        { id: "a", platform: "instagram", accountName: "@x", brandId: null },
        { id: "a", platform: "instagram", accountName: "@x", brandId: null },
        { id: "b", platform: " ", accountName: null, brandId: null },
      ],
      null,
    );
    check(
      "duplicate ids and blank platforms do not duplicate a channel or an account",
      dup.length === 2 && dup.every((c) => c.accounts.length === 1),
      dup.map((c) => [c.platform, c.accounts.length]),
    );
  }

  {
    const out = resolveChannels([{ id: "m", platform: "myspace", accountName: "tom", brandId: null }], null);
    check("an account platform nothing can publish yields no channel", out.length === 0, out);
  }

  return cases;
}
