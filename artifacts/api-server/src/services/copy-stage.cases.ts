/**
 * Stage 04 Copy cases, shared by the vitest suite and the tsx runner.
 *
 * The invariant with the most riding on it is `stagesStaledByCopy`: the hook is a
 * composited layer, so rewriting copy must NEVER restale the image. Returning
 * "asset" there would resurrect the exact behaviour this stage was designed to
 * kill, and it would do so silently.
 */

import {
  COPY_PLATFORMS,
  HOOK_BUDGET_CHARS,
  PLATFORM_COPY_RULES,
  captionFit,
  channelsToOffer,
  effectiveCaptionLimit,
  hashtagNote,
  hookFit,
  normalizeHashtags,
  stagesStaledByCopy,
  voiceCheck,
  type ChannelCopy,
} from "./copy-stage.js";

export interface Case { name: string; ok: boolean; detail?: unknown }

const ch = (platform: string, authored = false): ChannelCopy =>
  ({ platform, caption: "x", hashtags: [], authored });

export async function collectCopyStageCases(): Promise<Case[]> {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ------------------------------------------------------- the central rule
  check("copy NEVER restales the image, because the hook is a layer over it",
    !stagesStaledByCopy().includes("asset" as never), stagesStaledByCopy());
  check("copy restales crops, because the text has to reflow in each safe area",
    stagesStaledByCopy().includes("crops"));
  check("copy restales crops and nothing else", stagesStaledByCopy().length === 1);

  // ------------------------------------------------------------ real limits
  check("X is 280, not a guess", PLATFORM_COPY_RULES.twitter?.caption === 280);
  check("Instagram feed is 2200", PLATFORM_COPY_RULES.instagram_feed?.caption === 2200);
  check("LinkedIn is 3000", PLATFORM_COPY_RULES.linkedin?.caption === 3000);
  // ">= 1", not "> 1": X's real name is a single character, and a check that
  // demanded two would be asserting a house style rather than a fact.
  check("every platform has a label a person can read",
    COPY_PLATFORMS.every(p => (PLATFORM_COPY_RULES[p]?.label ?? "").trim().length >= 1));
  check("a brand rule can TIGHTEN the limit", effectiveCaptionLimit("twitter", { twitter: { char_limit: 200 } }) === 200);
  check("a brand rule can NEVER exceed the platform's real cap, or we promise what the platform will not keep",
    effectiveCaptionLimit("twitter", { twitter: { char_limit: 5000 } }) === 280);
  check("no brand rule means the platform cap", effectiveCaptionLimit("twitter", null) === 280);
  check("a junk brand rule is ignored rather than trusted",
    effectiveCaptionLimit("twitter", { twitter: { char_limit: -5 } }) === 280);
  check("an unknown platform still yields a usable limit", effectiveCaptionLimit("mystery", null) === 2200);

  // ---------------------------------------------------------------- fitting
  {
    const ok = captionFit("short", 280);
    check("a short caption is ok and reports what is left", ok.state === "ok" && ok.remaining === 275);
    const tight = captionFit("x".repeat(270), 280);
    check("near the cap reads as tight, so the warning arrives before the problem", tight.state === "tight");
    const over = captionFit("x".repeat(281), 280);
    check("past the cap reads as over", over.state === "over" && over.remaining === -1);
    check("exactly at the cap is not over", captionFit("x".repeat(280), 280).state !== "over");
  }
  check("counting is by character, not by UTF-16 unit, so emoji count as one",
    captionFit("👋", 280).chars === 1, captionFit("👋", 280).chars);

  // ------------------------------------------------------------- the hook
  check("a short hook fits its budget", hookFit("Crown U").state === "ok");
  check("the hook budget is smaller than any caption limit, because it is physical",
    HOOK_BUDGET_CHARS < PLATFORM_COPY_RULES.twitter!.caption);
  check("a long hook reports that it will reflow, which is what restales crops",
    hookFit("x".repeat(80)).reflows === true);
  check("a hook just past its budget does not yet reflow",
    hookFit("x".repeat(50)).reflows === false && hookFit("x".repeat(50)).state === "over");

  // ------------------------------------------------------------ voice check
  check("a banned term is found", voiceCheck("this is epic", ["epic"]).some(n => n.kind === "banned_term"));
  check("banned matching is case insensitive", voiceCheck("this is EPIC", ["epic"]).length > 0);
  check("clean copy against no rules yields no notes", voiceCheck("A clean line.", []).length === 0);
  check("shouting is flagged", voiceCheck("THIS IS THE BIGGEST DROP EVER", []).some(n => n.kind === "shouting"));
  check("a short all-caps word is not shouting", voiceCheck("CU wins", []).every(n => n.kind !== "shouting"));
  check("hashtags in the body are flagged, because they have their own slot",
    voiceCheck("big news #crownu", []).some(n => n.kind === "hashtags_in_body"));
  check("notes are machine readable so the UI need not match strings",
    voiceCheck("this is epic", ["epic"]).every(n => typeof n.kind === "string" && typeof n.message === "string"));

  // ------------------------------------------------- derived channel offers
  check("derived channels are offered a re-derive",
    channelsToOffer([ch("twitter"), ch("linkedin")]).length === 2);
  check("a hand-written channel is EXCLUDED, so typing is never silently overwritten",
    channelsToOffer([ch("twitter", true), ch("linkedin")]).join() === "linkedin");
  check("all-authored means nothing is offered",
    channelsToOffer([ch("twitter", true), ch("linkedin", true)]).length === 0);

  // -------------------------------------------------------------- hashtags
  check("within convention yields no note", hashtagNote("twitter", ["#a", "#b"]) === null);
  check("past convention yields an advisory naming the channel",
    (hashtagNote("twitter", ["#a", "#b", "#c", "#d"]) ?? "").includes("X"));
  check("normalising adds a single hash", normalizeHashtags(["crownu"])[0] === "#crownu");
  check("normalising strips extra hashes and spaces", normalizeHashtags(["##crown u"])[0] === "#crownu");
  check("duplicates collapse case-insensitively", normalizeHashtags(["#CrownU", "#crownu"]).length === 1);
  check("empties and non-strings are dropped", normalizeHashtags(["", "  ", 5, null, "#ok"]).length === 1);
  check("a non-array yields nothing", normalizeHashtags("nope").length === 0);

  return cases;
}
