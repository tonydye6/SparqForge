/**
 * Publish-failure classification cases, shared by the vitest suite and the tsx
 * runner, following the pattern set by brief-intake.cases.ts.
 *
 * THE INVARIANT THIS FILE EXISTS FOR, and the reason it is worth more than the
 * rest put together:
 *
 *   RETRY IS NEVER OFFERED FOR A FAILURE THAT RETRYING CANNOT FIX.
 *
 * Every real error string the build can produce is exercised below, taken from
 * publish-scheduler.ts and the five platform adapters rather than invented, so
 * a new message in one of them shows up here as a case that falls through to
 * `unknown` instead of as a wrong button in production.
 */

import { classifyFailure, groupFailures, type FailureInput } from "./publish-failures.js";

export interface Case {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const row = (over: Partial<FailureInput> = {}): FailureInput => ({
  publishError: null,
  retryCount: 0,
  socialAccountId: "acc-1",
  platform: "instagram_feed",
  ...over,
});

/**
 * Every error string the build can actually write, quoted from source.
 * publish-scheduler.ts writes the first block; the adapters write the rest.
 */
const REAL_ERRORS: Array<{ text: string; expect: string; note: string }> = [
  { text: "No social account connected for this entry", expect: "no_account", note: "scheduler" },
  { text: "Social account not found", expect: "no_account", note: "scheduler" },
  { text: "Platform mismatch: entry is tiktok but account is twitter", expect: "wrong_account", note: "scheduler" },
  { text: "Brand mismatch: account belongs to brand a but creative belongs to brand b", expect: "wrong_account", note: "scheduler" },
  { text: "Failed to decrypt access token", expect: "auth_expired", note: "scheduler" },
  { text: "Creative variant not found", expect: "missing_media", note: "scheduler" },
  { text: "Variant does not belong to the entry's creative", expect: "missing_media", note: "scheduler" },
  { text: "No public image URL available for Instagram", expect: "missing_media", note: "scheduler" },
  { text: "No video file available for YouTube upload", expect: "missing_media", note: "scheduler" },
  { text: "Could not resolve video file path for YouTube", expect: "missing_media", note: "scheduler" },
  { text: "TikTok requires a media file (video or image)", expect: "missing_media", note: "tiktok" },
  { text: "Media file not found: uploads/generated/x.mp4", expect: "missing_media", note: "tiktok" },
  { text: "Invalid media path: ../etc", expect: "missing_media", note: "tiktok" },
  { text: "Cannot determine public URL for photo upload", expect: "missing_media", note: "tiktok" },
  { text: "Duplicate video detected: This video has already been uploaded to YouTube.", expect: "duplicate", note: "youtube" },
  { text: "YouTube API quota exceeded. Try again later.", expect: "rate_limited", note: "youtube" },
  { text: "YouTube upload limit exceeded. Try again later.", expect: "rate_limited", note: "youtube" },
  { text: "TikTok publish timed out waiting for confirmation", expect: "timed_out", note: "tiktok" },
  { text: "Instagram media container processing timed out", expect: "timed_out", note: "instagram" },
  { text: "Instagram API error (400): {\"error\":{\"message\":\"caption too long\"}}", expect: "rejected", note: "instagram" },
  { text: "LinkedIn API error (422): unprocessable", expect: "rejected", note: "linkedin" },
  { text: "TikTok video init failed (403): forbidden", expect: "rejected", note: "tiktok" },
  { text: "Instagram media container processing failed", expect: "unknown", note: "instagram" },
  { text: "Unsupported platform: myspace", expect: "unknown", note: "scheduler" },
];

export function collectPublishFailureCases(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ------------------------------------------------- every real error string
  for (const e of REAL_ERRORS) {
    const out = classifyFailure(row({ publishError: e.text }));
    check(
      `${e.note}: "${e.text.slice(0, 46)}" reads as ${e.expect}`,
      out.kind === e.expect,
      out.kind,
    );
  }

  // -------------------------------------- THE invariant: no impossible retry
  {
    const unfixableByRetry = REAL_ERRORS.filter((e) =>
      ["no_account", "wrong_account", "auth_expired", "missing_media", "duplicate", "rejected"].includes(e.expect),
    );
    const offenders = unfixableByRetry
      .map((e) => ({ e, out: classifyFailure(row({ publishError: e.text })) }))
      .filter(({ out }) => out.action === "retry");
    check(
      "retry is never the action for a failure retrying cannot fix",
      offenders.length === 0,
      offenders.map((o) => o.e.text),
    );
    const claiming = unfixableByRetry
      .map((e) => classifyFailure(row({ publishError: e.text })))
      .filter((out) => out.willRetryItself);
    check(
      "and none of them claims the scheduler will fix it on its own",
      claiming.length === 0,
      claiming.map((c) => c.kind),
    );
  }

  // ------------------------------------------------------- the column check
  {
    // The scheduler's retry poll only considers entries WITH an account, so a
    // row with none is stuck no matter what its message says.
    const out = classifyFailure(row({ socialAccountId: null, publishError: "Instagram API error (500): boom" }));
    check("a missing account beats the message, because that row can never be picked up", out.kind === "no_account", out.kind);
    check("and it is not described as self-healing", out.willRetryItself === false);
  }

  // ------------------------------------------------------------- retry copy
  {
    const fresh = classifyFailure(row({ publishError: "Instagram media container processing failed", retryCount: 0 }));
    check("an unknown failure with retries left says it will try again", fresh.willRetryItself === true, fresh.guidance);
    const spent = classifyFailure(row({ publishError: "Instagram media container processing failed", retryCount: 3 }));
    check("and once they are spent it says it has stopped", spent.willRetryItself === false, spent.guidance);
    check("but sending it by hand is still offered", spent.action === "retry");
  }

  {
    const spent = classifyFailure(row({ publishError: "YouTube API quota exceeded. Try again later.", retryCount: 3, platform: "youtube" }));
    check("a rate limit that ran out of retries stops claiming it will heal", spent.willRetryItself === false, spent.guidance);
  }

  // ------------------------------------------------------------------ fault
  {
    check("a missing file is ours", classifyFailure(row({ publishError: "Media file not found: x" })).fault === "us");
    check("a refusal is the platform's", classifyFailure(row({ publishError: "Instagram API error (400): nope" })).fault === "platform");
    check("a duplicate is the user's", classifyFailure(row({ publishError: "Duplicate video detected: x" })).fault === "you");
    // Principle 1.14: never blame the platform for our bug.
    const unknown = classifyFailure(row({ publishError: "something nobody has seen" }));
    check("an unexplained failure is ours, not blamed on the platform", unknown.fault === "us", unknown.fault);
  }

  // ----------------------------------------------------------- human naming
  {
    const out = classifyFailure(row({ platform: "instagram_story", socialAccountId: null }));
    check("a message names the channel the way a person would", out.title.includes("an Instagram Story"), out.title);
    const x = classifyFailure(row({ platform: "twitter", socialAccountId: null }));
    check("and X is called X", x.title.includes("X account"), x.title);
  }

  {
    const out = classifyFailure(row({ publishError: null }));
    check("a failure with no message at all still classifies", out.kind === "unknown", out);
    check("and carries no invented technical detail", out.technical === null);
    const raw = classifyFailure(row({ publishError: "Instagram API error (400): caption" }));
    check("the vendor's own words are kept, not thrown away", raw.technical?.includes("caption") === true);
  }

  // ------------------------------------------------------------- grouping
  {
    const rows = [
      row({ publishError: "No social account connected for this entry", socialAccountId: null, platform: "tiktok" }),
      row({ publishError: "No social account connected for this entry", socialAccountId: null, platform: "tiktok" }),
      row({ publishError: "No social account connected for this entry", socialAccountId: null, platform: "tiktok" }),
      row({ publishError: "Instagram media container processing failed" }),
    ];
    const groups = groupFailures(rows);
    check("six posts blocked by one account are one problem, not six", groups.length === 2, groups.map((g) => g.entries.length));
    check("the group needing a human comes first", groups[0].action === "connect_account", groups.map((g) => g.action));
    check("the self-healing group comes last", groups[groups.length - 1].willRetryItself === true, groups.map((g) => g.willRetryItself));
    check("each entry keeps its own classification", groups[0].entries.every((e) => e.typed.kind === "no_account"));
    check(
      "a group names its platform, so the client does not need a second spelling of it",
      groups[0].where === "TikTok",
      groups[0].where,
    );
  }

  {
    // Two accounts with the same problem stay separate, because fixing one does
    // not fix the other.
    const groups = groupFailures([
      row({ publishError: "Failed to decrypt access token", socialAccountId: "acc-1" }),
      row({ publishError: "Failed to decrypt access token", socialAccountId: "acc-2" }),
    ]);
    check("the same fault on two accounts is two problems", groups.length === 2, groups.length);
  }

  {
    const mixed = groupFailures([
      row({ publishError: "YouTube API quota exceeded. Try again later.", retryCount: 0, socialAccountId: "acc-9", platform: "youtube" }),
      row({ publishError: "YouTube API quota exceeded. Try again later.", retryCount: 3, socialAccountId: "acc-9", platform: "youtube" }),
    ]);
    check(
      "a group is only self-healing if every post in it is",
      mixed.length === 1 && mixed[0].willRetryItself === false,
      mixed.map((g) => g.willRetryItself),
    );
  }

  check("grouping nothing produces nothing rather than throwing", groupFailures([]).length === 0);

  return cases;
}
