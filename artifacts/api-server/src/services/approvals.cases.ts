/**
 * Assertions for approvals. Shared by the vitest suite and the tsx verify
 * reporter, so both run exactly the same checks.
 */
import { REJECT_REASONS } from "@workspace/db/schema";
import {
  REJECT_CATEGORIES,
  rejectCategory,
  taxonomyIsComplete,
  suggestStage,
  assignableStages,
  labelForStage,
  canDecide,
  canRequest,
  canComment,
  describeRole,
  checkDecision,
  creativeStatusAfter,
  commentsForStage,
  stageNoteSummary,
  approvalStatus,
  type StageRef,
  type CommentRef,
  type ApprovalRef,
} from "./approvals.js";

export interface CaseResult {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const results: CaseResult[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
}

/** A full spine, every stage having run. */
const spine = (over: Partial<Record<string, string>> = {}): StageRef[] => [
  { id: "s1", stageNumber: 1, stageKind: "brief", status: over.brief ?? "done" },
  { id: "s2", stageNumber: 2, stageKind: "direction", status: over.direction ?? "done" },
  { id: "s3", stageNumber: 3, stageKind: "asset", status: over.asset ?? "done" },
  { id: "s4", stageNumber: 4, stageKind: "copy", status: over.copy ?? "done" },
  { id: "s5", stageNumber: 5, stageKind: "crops", status: over.crops ?? "done" },
];

const c = (over: Partial<CommentRef> = {}): CommentRef => ({
  id: "c1", stageStateId: "s2", slotKey: null, body: "Direction is wrong.",
  authorId: "chase", createdAt: "2026-08-01T00:00:00.000Z", resolvedAt: null, ...over,
});

const ap = (over: Partial<ApprovalRef> = {}): ApprovalRef => ({
  id: "a1", requestedBy: "chase", requestedAt: "2026-08-01T00:00:00.000Z",
  decidedBy: null, decidedAt: null, decision: null,
  rejectReason: null, rejectStageStateId: null, note: null, ...over,
});

export async function collectApprovalsCases(): Promise<CaseResult[]> {
  results.length = 0;

  // ---- the taxonomy, now server-side and complete ----
  {
    check("every stored reason has a definition", taxonomyIsComplete(), REJECT_CATEGORIES.map(x => x.slug));
    check("there are seven", REJECT_REASONS.length === 7);
    for (const slug of REJECT_REASONS) {
      const cat = rejectCategory(slug);
      check(`"${slug}" has a label and a description`, Boolean(cat?.label && cat?.description));
    }
    check("an unknown slug is not invented", rejectCategory("made_up") === null);
  }

  // ---- the suggestion, which is a suggestion ----
  {
    const s = spine();
    check("off-brand points at Direction", suggestStage("off_brand", s).stageStateId === "s2");
    check("image quality points at Image", suggestStage("image_quality", s).stageStateId === "s3");
    check("caption points at Copy", suggestStage("caption_issues", s).stageStateId === "s4");
    check("headline also points at Copy", suggestStage("headline_issues", s).stageStateId === "s4");
    check("platform mismatch points at crops", suggestStage("platform_mismatch", s).stageStateId === "s5");

    // The two that deliberately refuse to guess.
    const tm = suggestStage("trademark_violation", s);
    check("trademark suggests nothing", tm.stageStateId === null);
    check("and says why it will not guess", /more than one stage/.test(tm.why), tm.why);
    check("'something else' suggests nothing", suggestStage("other", s).stageStateId === null);

    check("a suggestion explains itself", /pre-selected/.test(suggestStage("off_brand", s).why));
    check("an unknown reason suggests nothing", suggestStage("nope", s).stageStateId === null);
  }
  {
    // A stage that never ran cannot have caused anything.
    const s = spine({ copy: "empty" });
    const out = suggestStage("caption_issues", s);
    check("an empty stage is not suggested", out.stageStateId === null);
    check("and says so in plain words", /has not run yet/.test(out.why), out.why);
    check("the stage is named, not numbered", /Copy/.test(out.why));
    check("a missing stage is handled", suggestStage("crops" === "crops" ? "platform_mismatch" : "", spine().slice(0, 4)).stageStateId === null);
  }
  {
    const s = spine({ copy: "empty", crops: "empty" });
    const ok = assignableStages(s);
    check("only stages that ran are assignable", ok.length === 3, ok.map(x => x.stageKind));
    check("and they come back in spine order", ok.map(x => x.stageKind).join(",") === "brief,direction,asset");
    check("stage labels are words", labelForStage("asset") === "Media" && labelForStage("crops") === "Launch pad");
  }

  // ---- who may do what ----
  {
    check("an editor may decide", canDecide("editor") && canRequest("editor") && canComment("editor"));
    check("an admin may decide", canDecide("admin"));
    check("a viewer may not decide", !canDecide("viewer") && !canRequest("viewer"));
    check("an unknown role may not decide", !canDecide("") && !canDecide("robot"));
    check("a viewer is told what they CAN do", /read and comment/.test(describeRole("viewer")));
    check("an unrecognised role assumes nothing", /not recognised/.test(describeRole("robot")));
  }

  // ---- the decision ----
  {
    const s = spine();
    const okApprove = checkDecision({ decision: "approved" }, s);
    check("an approval is accepted", okApprove.ok);
    check("approving carries no reason", okApprove.ok && okApprove.reason === null && okApprove.stageStateId === null);

    const withReason = checkDecision({ decision: "approved", reason: "off_brand" }, s);
    check("an approval with a reject reason is refused", !withReason.ok);
    check("and says nothing was saved", !withReason.ok && /Nothing was saved/.test(withReason.error));
    check("an approval naming a stage is refused", !checkDecision({ decision: "approved", stageStateId: "s2" }, s).ok);
  }
  {
    const s = spine();
    const noReason = checkDecision({ decision: "needs_work" }, s);
    check("sending back with no reason is refused", !noReason.ok);
    check("and the refusal explains the point", !noReason.ok && /knows what to change/.test(noReason.error), noReason);

    const bogus = checkDecision({ decision: "needs_work", reason: "nonsense" }, s);
    check("an invented reason is refused", !bogus.ok);

    const other = checkDecision({ decision: "needs_work", reason: "other" }, s);
    check('"something else" with no note is refused', !other.ok);
    const otherOk = checkDecision({ decision: "needs_work", reason: "other", note: "the crown is upside down" }, s);
    check('"something else" with a note is accepted', otherOk.ok);

    const good = checkDecision({ decision: "needs_work", reason: "off_brand", stageStateId: "s2", note: " too purple " }, s);
    check("a complete rejection is accepted", good.ok);
    check("the note is trimmed", good.ok && good.note === "too purple");
    check("the stage travels with it", good.ok && good.stageStateId === "s2");

    check("a blank note becomes null rather than an empty string",
      (checkDecision({ decision: "approved", note: "   " }, s) as { note: string | null }).note === null);
  }
  {
    const s = spine({ copy: "empty" });
    const atEmpty = checkDecision({ decision: "needs_work", reason: "caption_issues", stageStateId: "s4" }, s);
    check("a rejection cannot be pinned to a stage that never ran", !atEmpty.ok);
    check("and the refusal names the stage", !atEmpty.ok && /Copy has not run yet/.test(atEmpty.error), atEmpty);

    const foreign = checkDecision({ decision: "needs_work", reason: "off_brand", stageStateId: "somebody-elses-stage" }, s);
    check("a stage from another creative is refused", !foreign.ok);

    check("a decision that is neither is refused", !checkDecision({ decision: "maybe" as never }, s).ok);
  }
  {
    // Approving schedules. It does NOT publish, and it never has.
    check("approving schedules", creativeStatusAfter("approved") === "scheduled");
    check("sending back returns it to draft", creativeStatusAfter("needs_work") === "draft");
  }

  // ---- resurfacing ----
  {
    const list = [
      c({ id: "old", createdAt: "2026-07-01T00:00:00.000Z" }),
      c({ id: "new", createdAt: "2026-08-05T00:00:00.000Z" }),
      c({ id: "done", createdAt: "2026-07-15T00:00:00.000Z", resolvedAt: "2026-07-16T00:00:00.000Z" }),
      c({ id: "elsewhere", stageStateId: "s3" }),
      c({ id: "creative-wide", stageStateId: null }),
    ];
    const out = commentsForStage(list, "s2");
    check("only this stage's notes come back", out.open.map(x => x.id).join(",") === "old,new", out.open.map(x => x.id));
    check("oldest first, because the ignored one matters most", out.open[0]?.id === "old");
    check("resolved notes are kept, not dropped", out.resolved.map(x => x.id).join(",") === "done");
    check("a creative-wide note does not attach to a stage", !out.open.some(x => x.id === "creative-wide"));
  }
  {
    // A slot-specific note surfaces on its slot; an unslotted one surfaces on all.
    const list = [c({ id: "slot", slotKey: "as_briefed__mid" }), c({ id: "any", slotKey: null })];
    const mine = commentsForStage(list, "s2", "as_briefed__mid");
    check("a slot note surfaces on its slot", mine.open.map(x => x.id).sort().join(",") === "any,slot");
    const other = commentsForStage(list, "s2", "teased__raw");
    check("and not on another slot", other.open.map(x => x.id).join(",") === "any", other.open.map(x => x.id));
  }
  {
    check("no notes means no line at all", stageNoteSummary([]) === "");
    check("one note is singular", stageNoteSummary([c()]) === "1 note is waiting on this stage.");
    check("two notes are plural", /^2 notes/.test(stageNoteSummary([c(), c({ id: "c2" })])));
  }

  // ---- needs you ----
  {
    const none = approvalStatus([], "tony", "editor");
    check("no request is a real state", none.state === "none" && !none.needsYou);
    check("and says so plainly", /Nobody has asked/.test(none.summary));
  }
  {
    const open = [ap({ requestedBy: "chase" })];
    const forTony = approvalStatus(open, "tony", "editor");
    check("an open request needs the OTHER person", forTony.state === "awaiting" && forTony.needsYou);
    check("and says so", forTony.summary === "This is waiting on you.");

    // The rule that keeps the badge meaningful.
    const forChase = approvalStatus(open, "chase", "editor");
    check("you are not blocked by your own request", !forChase.needsYou, forChase);
    // A requester who can ALSO decide reads both truths: it used to say
    // "waiting on someone else" directly above live Approve buttons.
    check(
      "and a decide-capable asker is told they may decide it themselves",
      /you can decide it yourself/.test(forChase.summary),
      forChase.summary,
    );
    // A requester who genuinely cannot decide keeps the old sentence.
    const forChaseAsViewer = approvalStatus(open, "chase", "viewer");
    check(
      "an asker with no decide power is told it waits on someone else",
      /waiting on someone else/.test(forChaseAsViewer.summary),
      forChaseAsViewer.summary,
    );

    const forViewer = approvalStatus(open, "jan", "viewer");
    check("a viewer is never 'needs you'", !forViewer.needsYou);
    check("but still sees the state", forViewer.state === "awaiting");
  }
  {
    const approved = approvalStatus(
      [ap({ decidedAt: "2026-08-02T00:00:00.000Z", decidedBy: "tony", decision: "approved" })],
      "tony", "editor",
    );
    check("an approved creative reads approved", approved.state === "approved" && !approved.needsYou);
    // The line that must never become untrue.
    check("and says explicitly that it was NOT published", /has not been published/.test(approved.summary), approved.summary);
  }
  {
    const sent = approvalStatus(
      [ap({ decidedAt: "2026-08-02T00:00:00.000Z", decidedBy: "tony", decision: "needs_work", rejectReason: "off_brand", rejectStageStateId: "s2", note: "too purple" })],
      "chase", "editor",
    );
    check("a rejection reads as sent back", sent.state === "needs_work");
    check("the reason is in the summary", /off-brand/.test(sent.summary), sent.summary);
    check("the note is quoted", /"too purple"/.test(sent.summary));
    check("the causing stage is preserved", sent.latest?.rejectStageStateId === "s2");
  }
  {
    // The LATEST request decides the state, not the first.
    const history = [
      ap({ id: "old", requestedAt: "2026-07-01T00:00:00.000Z", decidedAt: "2026-07-02T00:00:00.000Z", decidedBy: "tony", decision: "needs_work", rejectReason: "off_brand" }),
      ap({ id: "new", requestedAt: "2026-08-06T00:00:00.000Z" }),
    ];
    const st = approvalStatus(history, "tony", "editor");
    check("the newest request is the live one", st.state === "awaiting" && st.latest?.id === "new", st.latest?.id);
    check("and an old rejection does not linger", st.summary === "This is waiting on you.");
  }

  return results;
}
