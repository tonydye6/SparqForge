/**
 * Phase 6 · approval as an act, and a reason that lands somewhere.
 *
 * The old Review Queue could never fill and its Approve button 400'd by design.
 * That was not a bug to fix in place: the queue implemented a pipeline the
 * Co-pilot had already collapsed into a conversation, so the decision was to
 * dissolve it and **keep the taxonomy**. This is where the taxonomy lands.
 *
 * The seven categories already existed, in the client, encoded into a free-text
 * field as `[CATEGORY:off_brand] …` with a regex to read them back — because
 * reject reasons had no column. A category in a string prefix can only be
 * displayed. A category in a column can be counted, and pointed at a stage.
 *
 * **That pointing is the whole phase.** "Off-brand" in a dropdown is a shrug.
 * "Off-brand, and it was Direction that caused it" is a note waiting on stage
 * 02 when somebody reopens it, and a row that can later answer which stage this
 * team sends back most often.
 *
 * Two rules the surrounding system already fixed, which this must not break:
 *
 *  - **Sending back does NOT reopen anything.** §1.5: reopening is consent and
 *    marking stale is a choice someone makes. A decision that reopened stage 02
 *    on its own would take that choice away and silently invalidate work
 *    downstream. The reason is recorded and waits.
 *  - **Approving does NOT publish.** It moves the creative to scheduled. Every
 *    publishing path stays exactly where it was.
 *
 * Pure: no DB, no clock, no model call. Every function that needs the time or
 * an id takes it as an argument.
 */

import type { RejectReason, ApprovalDecision, StageKind } from "@workspace/db";
/*
 * From `@workspace/db/schema`, NOT `@workspace/db`.
 *
 * The package root builds a connection pool at import time and throws without
 * DATABASE_URL. These are the only two runtime values this file needs, and
 * taking them from the root would make a pure service require a database to
 * load — which would quietly cost it the tsx-verify path that every other
 * service here has. The schema entry is table definitions and constants only.
 */
import { REJECT_REASONS, STAGE_ORDER } from "@workspace/db/schema";

export interface RejectCategory {
  slug: RejectReason;
  label: string;
  description: string;
  /**
   * The stage this usually comes from. A SUGGESTION, never a determination.
   *
   * The same complaint genuinely arrives from different places: a trademark can
   * reach a post through the image or through the caption, and "off-brand" can
   * be the director's fault or the brand record's. So this pre-selects and the
   * person choosing can move it. Guessing silently would put bad rows into the
   * only aggregation this table exists to support.
   */
  suggests: StageKind | null;
}

export const REJECT_CATEGORIES: RejectCategory[] = [
  {
    slug: "off_brand",
    label: "Off-brand",
    description: "Colours, voice or visual style do not match this brand.",
    suggests: "direction",
  },
  {
    slug: "image_quality",
    label: "Image quality",
    description: "Artifacts, wrong composition, poor lighting, or visual defects.",
    suggests: "asset",
  },
  {
    slug: "caption_issues",
    label: "Caption",
    description: "Tone, length, grammar or hashtag problems.",
    suggests: "copy",
  },
  {
    slug: "headline_issues",
    label: "Headline",
    description: "Overlay text is wrong, illegible or badly positioned.",
    suggests: "copy",
  },
  {
    slug: "platform_mismatch",
    label: "Wrong for the platform",
    description: "The crop or the format does not suit where it is going.",
    suggests: "crops",
  },
  {
    slug: "trademark_violation",
    label: "Trademark or legal",
    description: "A mark that should not be there, a banned term, or a licensing problem.",
    // Deliberately null. The live scan found marks arriving through the IMAGE,
    // baked into a source asset, and the banned-terms check catches them in
    // COPY. Picking one would be wrong half the time on the one category where
    // being wrong is most expensive.
    suggests: null,
  },
  {
    slug: "other",
    label: "Something else",
    description: "Say what, and point it at the stage that caused it.",
    suggests: null,
  },
];

const BY_SLUG = new Map(REJECT_CATEGORIES.map(c => [c.slug, c]));

export function rejectCategory(slug: string): RejectCategory | null {
  return BY_SLUG.get(slug as RejectReason) ?? null;
}

/** Every category has a definition, checked rather than assumed. */
export function taxonomyIsComplete(): boolean {
  return REJECT_REASONS.every(r => BY_SLUG.has(r)) && REJECT_CATEGORIES.length === REJECT_REASONS.length;
}

export interface StageRef {
  id: string;
  stageNumber: number;
  stageKind: StageKind;
  status: string;
}

/**
 * Which stage a rejection should be pointed at, given what actually exists.
 *
 * Returns the suggestion only when that stage HAS RUN. Sending "the caption is
 * wrong" back to a Copy stage nobody has opened is a note addressed to nobody,
 * and it would make the aggregation claim Copy causes rejections on creatives
 * where Copy never happened.
 */
export function suggestStage(
  reason: string,
  stages: readonly StageRef[],
): { stageStateId: string | null; why: string } {
  const category = rejectCategory(reason);
  if (!category) return { stageStateId: null, why: "That is not one of the reasons, so nothing was suggested." };
  if (!category.suggests) {
    return { stageStateId: null, why: `"${category.label}" can come from more than one stage, so choose the one that caused it.` };
  }
  const stage = stages.find(s => s.stageKind === category.suggests);
  if (!stage) {
    return { stageStateId: null, why: `This creative has no ${category.suggests} stage.` };
  }
  if (stage.status === "empty") {
    return {
      stageStateId: null,
      why: `${labelForStage(stage.stageKind)} has not run yet, so it cannot be what caused this.`,
    };
  }
  return { stageStateId: stage.id, why: `${labelForStage(stage.stageKind)} usually causes this, so it is pre-selected. Change it if that is wrong.` };
}

const STAGE_LABELS: Record<StageKind, string> = {
  brief: "Spark",
  direction: "Director",
  asset: "Media",
  copy: "Copy",
  crops: "Launch pad",
};

export function labelForStage(kind: StageKind): string {
  return STAGE_LABELS[kind];
}

/** Stages a rejection may be pointed at: the ones that have actually run. */
export function assignableStages(stages: readonly StageRef[]): StageRef[] {
  return [...stages]
    .filter(s => s.status !== "empty")
    .sort((a, b) => STAGE_ORDER.indexOf(a.stageKind) - STAGE_ORDER.indexOf(b.stageKind));
}

/* ------------------------------------------------------------------------- *
 * Who may do what
 * ------------------------------------------------------------------------- */

export type Role = "viewer" | "editor" | "admin";

/**
 * Deciding is an editor's act, not an admin's.
 *
 * Matching the July 2026 owner decision that moved bulk and destructive
 * mutations from admin to editor: this team's editors are the people doing the
 * work, and an approval that only an admin can give is an approval that does
 * not happen. Viewers stay read-only, which is the one line that has never
 * moved.
 */
export function canDecide(role: string): boolean {
  return role === "editor" || role === "admin";
}
export function canRequest(role: string): boolean {
  return role === "editor" || role === "admin";
}
export function canComment(role: string): boolean {
  return role === "editor" || role === "admin";
}

/**
 * What this person may do, in words, for a UI that shows rather than hides.
 *
 * A viewer who sees a greyed-out button and no explanation concludes the
 * product is broken. Saying "you can read this, you cannot decide on it" costs
 * one line and is the whole difference.
 */
export function describeRole(role: string): string {
  if (role === "admin") return "You can edit, approve and send back.";
  if (role === "editor") return "You can edit, approve and send back.";
  if (role === "viewer") return "You can read and comment on this, but not change it or decide on it.";
  return "Your role is not recognised, so nothing is assumed about what you may do.";
}

/* ------------------------------------------------------------------------- *
 * The decision
 * ------------------------------------------------------------------------- */

export interface DecisionInput {
  decision: ApprovalDecision;
  reason?: string | null;
  stageStateId?: string | null;
  note?: string | null;
}

export type DecisionCheck =
  | { ok: true; decision: ApprovalDecision; reason: RejectReason | null; stageStateId: string | null; note: string | null }
  | { ok: false; error: string };

/**
 * Validate a decision before anything is written.
 *
 * Mirrors the database CHECKs deliberately rather than trusting them. The
 * constraints are the last line and they throw a Postgres error; this is the
 * line that produces a sentence a person can act on.
 */
export function checkDecision(input: DecisionInput, stages: readonly StageRef[]): DecisionCheck {
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;

  if (input.decision === "approved") {
    if (input.reason) {
      return { ok: false, error: "An approval cannot carry a reject reason. Nothing was saved." };
    }
    if (input.stageStateId) {
      return { ok: false, error: "An approval is not about one stage, so it cannot name one. Nothing was saved." };
    }
    return { ok: true, decision: "approved", reason: null, stageStateId: null, note };
  }

  if (input.decision !== "needs_work") {
    return { ok: false, error: "A decision is either approved or needs_work. Nothing was saved." };
  }

  const category = input.reason ? rejectCategory(input.reason) : null;
  if (!category) {
    // The point of the taxonomy. Sending work back without saying why is what
    // the old queue did, and the person who had to fix it learned nothing.
    return { ok: false, error: "Sending this back needs a reason, so whoever picks it up knows what to change. Nothing was saved." };
  }
  if (category.slug === "other" && !note) {
    return { ok: false, error: '"Something else" needs a note saying what. Nothing was saved.' };
  }

  if (input.stageStateId) {
    const stage = stages.find(s => s.id === input.stageStateId);
    if (!stage) {
      return { ok: false, error: "That stage is not on this creative, so nothing was saved." };
    }
    if (stage.status === "empty") {
      return {
        ok: false,
        error: `${labelForStage(stage.stageKind)} has not run yet, so it cannot be what caused this. Nothing was saved.`,
      };
    }
  }

  return { ok: true, decision: "needs_work", reason: category.slug, stageStateId: input.stageStateId ?? null, note };
}

/**
 * What a decision does to the creative.
 *
 * `approved` moves it to `scheduled` and NOTHING ELSE. It does not publish, it
 * does not touch a calendar entry, and it does not reach a social account.
 * `needs_work` moves it back to `draft` — but deliberately does not reopen,
 * stale or otherwise alter any stage. §1.5: reopening is consent.
 */
export function creativeStatusAfter(decision: ApprovalDecision): "scheduled" | "draft" {
  return decision === "approved" ? "scheduled" : "draft";
}

/* ------------------------------------------------------------------------- *
 * Resurfacing
 * ------------------------------------------------------------------------- */

export interface CommentRef {
  id: string;
  stageStateId: string | null;
  slotKey: string | null;
  body: string;
  authorId: string;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * What should be waiting when someone opens a stage.
 *
 * Unresolved first and oldest first, because the note that has been ignored
 * longest is the one most worth reading. Resolved notes are kept and returned
 * separately rather than dropped: the history of what was once wrong here is
 * the context for whoever is about to change it again.
 */
export function commentsForStage(
  comments: readonly CommentRef[],
  stageStateId: string,
  slotKey?: string | null,
): { open: CommentRef[]; resolved: CommentRef[] } {
  const mine = comments.filter(c =>
    c.stageStateId === stageStateId && (slotKey === undefined || c.slotKey === null || c.slotKey === slotKey),
  );
  const byAge = (a: CommentRef, b: CommentRef) => a.createdAt.localeCompare(b.createdAt);
  return {
    open: mine.filter(c => !c.resolvedAt).sort(byAge),
    resolved: mine.filter(c => c.resolvedAt).sort(byAge),
  };
}

/**
 * The one line a stage shows when it has notes on it.
 *
 * Returns empty rather than "0 comments". A stage with nothing said about it
 * should look like a stage with nothing said about it.
 */
export function stageNoteSummary(open: readonly CommentRef[]): string {
  if (open.length === 0) return "";
  return open.length === 1
    ? "1 note is waiting on this stage."
    : `${open.length} notes are waiting on this stage.`;
}

/* ------------------------------------------------------------------------- *
 * "Needs you"
 * ------------------------------------------------------------------------- */

export interface ApprovalRef {
  id: string;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decision: ApprovalDecision | null;
  rejectReason: RejectReason | null;
  rejectStageStateId: string | null;
  note: string | null;
}

export type ApprovalState = "none" | "awaiting" | "approved" | "needs_work";

export interface ApprovalStatus {
  state: ApprovalState;
  /** The request the state comes from, so a UI can name who and when. */
  latest: ApprovalRef | null;
  /** True when THIS person is the one being waited on. */
  needsYou: boolean;
  /** One sentence, always present. */
  summary: string;
}

/**
 * Where a creative stands, and whether it is waiting on the person looking.
 *
 * `needsYou` is deliberately NOT "you are an approver". It is "there is an open
 * request and you did not make it", because a person waiting on their own
 * request is not blocked by themselves, and a Pipeline that says otherwise
 * teaches people to ignore the badge.
 */
export function approvalStatus(
  approvals: readonly ApprovalRef[],
  viewerId: string,
  viewerRole: string,
): ApprovalStatus {
  const sorted = [...approvals].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const latest = sorted[0] ?? null;

  if (!latest) {
    return { state: "none", latest: null, needsYou: false, summary: "Nobody has asked for a decision on this yet." };
  }
  if (!latest.decidedAt) {
    const needsYou = canDecide(viewerRole) && latest.requestedBy !== viewerId;
    return {
      state: "awaiting",
      latest,
      needsYou,
      summary: needsYou
        ? "This is waiting on you."
        : latest.requestedBy === viewerId
          ? canDecide(viewerRole)
            /*
             * The asker who can also decide used to read "waiting on someone
             * else" directly above live Approve buttons (doc 40, found in the
             * review walk). Both facts are true; say both.
             */
            ? "You asked for a decision on this. Another approver can take it, or you can decide it yourself."
            : "You asked for a decision on this. It is waiting on someone else."
          : "This is waiting on a decision.",
    };
  }
  if (latest.decision === "approved") {
    return { state: "approved", latest, needsYou: false, summary: "Approved and scheduled. It has not been published." };
  }
  const category = latest.rejectReason ? rejectCategory(latest.rejectReason) : null;
  return {
    state: "needs_work",
    latest,
    needsYou: false,
    summary: category
      ? `Sent back: ${category.label.toLowerCase()}.${latest.note ? ` "${latest.note}"` : ""}`
      : "Sent back.",
  };
}
