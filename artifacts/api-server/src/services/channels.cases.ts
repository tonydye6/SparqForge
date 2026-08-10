/**
 * Channel-resolution cases, shared by the vitest suite and the tsx runner.
 *
 * The invariant worth protecting is that there is now exactly ONE answer to
 * "which channels is this post for", and it is grounded in a connected account
 * rather than in a list somebody typed into a component.
 */

import { resolveChannels } from "./channels.js";

export interface Case {
  name: string;
  ok: boolean;
  detail?: unknown;
}

export function collectChannelCases(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  {
    const out = resolveChannels([]);
    check("a brand with no connected account has no channels", out.length === 0, out);
  }

  {
    // Crown U's real state on the dev database.
    const out = resolveChannels(["instagram", "twitter"]);
    const platforms = out.map((c) => c.platform);
    check(
      "one Instagram account serves both the feed and the story",
      platforms.includes("instagram_feed") && platforms.includes("instagram_story"),
      platforms,
    );
    check("X comes from the twitter account", platforms.includes("twitter"));
    check(
      "and nothing else appears, because nothing else is connected",
      !platforms.includes("linkedin") && !platforms.includes("tiktok") && !platforms.includes("youtube"),
      platforms,
    );
  }

  {
    // The exact disagreement this module was written to end: stage 04 used to
    // offer LinkedIn on a brand with no LinkedIn account.
    const out = resolveChannels(["instagram", "twitter"]);
    check(
      "LinkedIn is not offered to a brand that cannot publish to LinkedIn",
      !out.some((c) => c.platform === "linkedin"),
      out.map((c) => c.platform),
    );
  }

  {
    const out = resolveChannels(["twitter", "instagram"]);
    check(
      "reading order is fixed, so the surfaces cannot list channels differently",
      out.map((c) => c.platform).join(",") === "instagram_feed,instagram_story,twitter",
      out.map((c) => c.platform),
    );
  }

  {
    const out = resolveChannels(["tiktok"]);
    check("TikTok resolves to a 9:16 channel", out[0]?.aspectLabel === "9:16", out[0]);
    check("and it has real safe-area data", out[0]?.hasSafeAreas === true, out[0]);
  }

  {
    // The distinction that a warning depends on: mapped with nothing to dodge
    // is a verified fact, unmapped is an absence of knowledge.
    const feed = resolveChannels(["instagram"]).find((c) => c.platform === "instagram_feed");
    const linkedin = resolveChannels(["linkedin"])[0];
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
  }

  {
    const out = resolveChannels(["linkedin", "youtube"]);
    const linkedin = out.find((c) => c.platform === "linkedin");
    const youtube = out.find((c) => c.platform === "youtube");
    check("a channel with no mapped furniture still resolves", out.length === 2, out.map((c) => c.platform));
    check(
      "and admits its furniture is unmapped rather than pretending",
      linkedin?.furnitureMapped === false && youtube?.furnitureMapped === false,
      out,
    );
    check("LinkedIn falls back to a square", linkedin?.aspectLabel === "1:1", linkedin);
    check("YouTube is 16:9, which is not a judgement call", youtube?.aspectLabel === "16:9", youtube);
    check("both still have copy limits", linkedin?.hasCopyRules === true && youtube?.hasCopyRules === true);
  }

  {
    const out = resolveChannels(["instagram", "instagram", " twitter ", ""]);
    check(
      "duplicates and whitespace in the account list do not duplicate a channel",
      out.map((c) => c.platform).join(",") === "instagram_feed,instagram_story,twitter",
      out.map((c) => c.platform),
    );
  }

  {
    const out = resolveChannels(["myspace"]);
    check("an account platform nothing can publish yields no channel", out.length === 0, out);
  }

  {
    const out = resolveChannels(["instagram"]);
    check(
      "every channel names the account that publishes it",
      out.every((c) => c.accountPlatform === "instagram"),
      out.map((c) => c.accountPlatform),
    );
  }

  return cases;
}
