/**
 * Phase 10 · typed publish failures, each with exactly one action.
 *
 * Doc 22 Phase 10 item 4: "In-app failure surface: typed failures, each with
 * one action, reading the existing `publishStatus`/`publishError`/`retryCount`."
 * Principle 2.5 is right that the DATA already exists; what did not exist was
 * anything that read it as anything other than a string.
 *
 * WHAT WAS WRONG BEFORE. The failure banner printed the vendor's raw error and
 * offered Retry on every row. For roughly half of the failures this build can
 * produce, retrying is GUARANTEED to fail again: no account is connected, the
 * account is for another platform, the token will not decrypt. Offering a
 * button that cannot work is worse than offering none, because the person
 * clicks it, watches nothing change, and stops believing the surface.
 *
 * So every failure gets a kind, and every kind gets ONE action, chosen because
 * it is the action that can actually resolve that kind.
 *
 * Principle 1.14, "never blame the platform for our bug", is why `fault` is a
 * field rather than a tone. A missing media file is ours. A 400 on the caption
 * is the platform's answer to something the user wrote. Saying which is what
 * makes the message worth reading.
 *
 * Pure and runnable under tsx, like the other services carrying invariants.
 */

// From the scheduler's own constants rather than a second copy: this module
// decides whether to tell somebody "it will try again on its own", and a
// duplicate that drifted would make that sentence a lie.
import { MAX_RETRIES } from "./publish-constants.js";

export type FailureKind =
  | "no_account"
  | "wrong_account"
  | "auth_expired"
  | "missing_media"
  | "duplicate"
  | "rejected"
  | "rate_limited"
  | "timed_out"
  | "unknown";

/**
 * Three actions, no more.
 *
 * `retry`           · re-queue it. Only ever offered when it could work.
 * `connect_account` · Settings. The account is missing, wrong or expired.
 * `open_post`       · the post itself. Something about it has to change.
 */
export type FailureAction = "retry" | "connect_account" | "open_post";

/** Whose problem this is. Named, because guessing is what breeds distrust. */
export type FailureFault = "us" | "platform" | "you";

export interface FailureInput {
  publishError: string | null;
  retryCount: number | null;
  socialAccountId: string | null;
  platform: string;
  accountName?: string | null;
}

export interface TypedFailure {
  kind: FailureKind;
  fault: FailureFault;
  /** One sentence saying what happened, in the user's terms. */
  title: string;
  /** One sentence saying what to do, or that nothing needs doing. */
  guidance: string;
  action: FailureAction;
  actionLabel: string;
  /**
   * Whether the scheduler will keep trying without anybody clicking.
   *
   * Separate from the action on purpose: a rate-limited post both retries on
   * its own AND can be retried by hand, and the copy has to be able to say the
   * first without hiding the second.
   */
  willRetryItself: boolean;
  /** The vendor's own words, kept for the person debugging rather than fixing. */
  technical: string | null;
}

const has = (haystack: string, ...needles: string[]) =>
  needles.some((n) => haystack.includes(n));

/** Human platform names, so a message never says `instagram_story`. */
export const PLATFORM_NAMES: Record<string, string> = {
  instagram: "Instagram",
  instagram_feed: "Instagram",
  instagram_story: "an Instagram Story",
  twitter: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform;
}

/**
 * Classify one failed calendar entry.
 *
 * Order matters. The checks run from the most specific and most actionable
 * downwards, so "no account connected" wins over the generic 400 that the same
 * row might also match. The fall-through is `unknown` with a retry, which is
 * the safe default: retrying something unclassified can work, and costs one
 * request.
 */
export function classifyFailure(input: FailureInput): TypedFailure {
  const raw = (input.publishError ?? "").trim();
  const lower = raw.toLowerCase();
  const where = platformName(input.platform);
  const retriesLeft = (input.retryCount ?? 0) < MAX_RETRIES;

  // Nothing to publish through. Checked first, and checked on the COLUMN as
  // well as the message, because the scheduler only picks up entries that have
  // an account: without this, such a row sits failed forever while the surface
  // insists it will retry.
  if (!input.socialAccountId || has(lower, "no social account connected", "social account not found")) {
    return {
      kind: "no_account",
      fault: "us",
      title: `No ${where} account is connected for this brand.`,
      guidance: "Connect one in Settings and this post can be sent again.",
      action: "connect_account",
      actionLabel: "Connect an account",
      willRetryItself: false,
      technical: raw || null,
    };
  }

  if (has(lower, "platform mismatch", "brand mismatch")) {
    return {
      kind: "wrong_account",
      fault: "us",
      title: `The connected account does not match this post's ${where} channel.`,
      guidance: "Point the post at the right account in Settings, then send it again.",
      action: "connect_account",
      actionLabel: "Check the accounts",
      willRetryItself: false,
      technical: raw || null,
    };
  }

  if (
    has(lower, "failed to decrypt access token", "invalid_token", "token expired", "access token")
    || has(lower, "(401)", "unauthorized", "oauthexception")
  ) {
    return {
      kind: "auth_expired",
      fault: "platform",
      title: `${where} is no longer accepting this account's sign-in.`,
      guidance: "Reconnect the account in Settings. Retrying before that will fail the same way.",
      action: "connect_account",
      actionLabel: "Reconnect the account",
      willRetryItself: false,
      technical: raw || null,
    };
  }

  if (
    has(
      lower,
      "no public image url",
      "no video file available",
      "could not resolve video file path",
      "media file not found",
      "invalid media path",
      "creative variant not found",
      "does not belong",
      "requires a media file",
      "cannot determine public url",
    )
  ) {
    return {
      kind: "missing_media",
      fault: "us",
      title: "The file this post was going to send is missing.",
      guidance: "Open the post and make its image or video again, then schedule it.",
      action: "open_post",
      actionLabel: "Open the post",
      willRetryItself: false,
      technical: raw || null,
    };
  }

  if (has(lower, "duplicate")) {
    return {
      kind: "duplicate",
      fault: "you",
      title: `${where} has already had this exact post.`,
      guidance: "Change the video or the caption, or drop this one from the schedule.",
      action: "open_post",
      actionLabel: "Open the post",
      willRetryItself: false,
      technical: raw || null,
    };
  }

  if (has(lower, "quota exceeded", "upload limit exceeded", "(429)", "rate limit", "too many requests")) {
    return {
      kind: "rate_limited",
      fault: "platform",
      title: `${where} is rate limiting this account right now.`,
      guidance: retriesLeft
        ? "Nothing needs doing: it will try again on its own shortly."
        : "It has stopped trying on its own. Send it again when the limit has passed.",
      action: "retry",
      actionLabel: "Send it now",
      willRetryItself: retriesLeft,
      technical: raw || null,
    };
  }

  if (has(lower, "timed out", "timeout", "(504)", "(502)", "(503)")) {
    return {
      kind: "timed_out",
      fault: "platform",
      title: `${where} did not answer in time.`,
      guidance: retriesLeft
        ? "Nothing needs doing: it will try again on its own."
        : "It has stopped trying on its own. Send it again.",
      action: "retry",
      actionLabel: "Send it now",
      willRetryItself: retriesLeft,
      technical: raw || null,
    };
  }

  // A 4xx that got this far is the platform refusing the content itself. The
  // scheduler already marks these permanent, so retrying unchanged is exactly
  // the thing that must not be offered as the answer.
  if (/\(4\d\d\)/.test(lower) || has(lower, "api error")) {
    return {
      kind: "rejected",
      fault: "platform",
      title: `${where} refused this post.`,
      guidance: "Open it and change what it objected to, then schedule it again.",
      action: "open_post",
      actionLabel: "Open the post",
      willRetryItself: false,
      technical: raw || null,
    };
  }

  return {
    kind: "unknown",
    fault: "us",
    title: `This post did not reach ${where}.`,
    guidance: retriesLeft
      ? "It will try again on its own. Sending it now is safe if you would rather not wait."
      : "It has stopped trying on its own. Sending it again is the next thing to try.",
    action: "retry",
    actionLabel: "Send it now",
    willRetryItself: retriesLeft,
    technical: raw || null,
  };
}

/**
 * Group failures so the surface leads with the fix, not with the count.
 *
 * Six posts failing for one disconnected account is ONE problem with one
 * action, and listing it six times is how a surface teaches people to scroll
 * past it. Grouping is by kind plus account, because that pair is what a single
 * action resolves.
 */
export interface FailureGroup<T> {
  key: string;
  kind: FailureKind;
  fault: FailureFault;
  /**
   * The platform, named the way a person would.
   *
   * On the group rather than derived in the client, so there is one spelling of
   * "Instagram" in the product and the client does not need its own copy of the
   * map to write the sentence that says whose end the problem is at.
   */
  where: string;
  title: string;
  guidance: string;
  action: FailureAction;
  actionLabel: string;
  willRetryItself: boolean;
  entries: T[];
}

export function groupFailures<T extends FailureInput>(
  rows: T[],
): Array<FailureGroup<T & { typed: TypedFailure }>> {
  const groups = new Map<string, FailureGroup<T & { typed: TypedFailure }>>();

  for (const row of rows) {
    const typed = classifyFailure(row);
    const key = `${typed.kind}:${row.socialAccountId ?? row.platform}`;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push({ ...row, typed });
      // A group is only self-healing if every post in it is.
      existing.willRetryItself = existing.willRetryItself && typed.willRetryItself;
      continue;
    }
    groups.set(key, {
      key,
      kind: typed.kind,
      fault: typed.fault,
      where: platformName(row.platform),
      title: typed.title,
      guidance: typed.guidance,
      action: typed.action,
      actionLabel: typed.actionLabel,
      willRetryItself: typed.willRetryItself,
      entries: [{ ...row, typed }],
    });
  }

  // Whatever needs a human first. A group that heals itself is last, because
  // reading it is optional.
  const rank: Record<FailureAction, number> = { connect_account: 0, open_post: 1, retry: 2 };
  return [...groups.values()].sort((a, b) => {
    if (a.willRetryItself !== b.willRetryItself) return a.willRetryItself ? 1 : -1;
    if (rank[a.action] !== rank[b.action]) return rank[a.action] - rank[b.action];
    return b.entries.length - a.entries.length;
  });
}
