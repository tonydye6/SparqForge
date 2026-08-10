import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  approvalsTable,
  commentsTable,
  creativesTable,
  stageStatesTable,
  usersTable,
} from "@workspace/db";
import { requireStandardWrite } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate.js";
import { recordAudit, actorFromRequest } from "../lib/audit.js";
import {
  REJECT_CATEGORIES,
  approvalStatus,
  assignableStages,
  canComment,
  canDecide,
  canRequest,
  checkDecision,
  commentsForStage,
  creativeStatusAfter,
  describeRole,
  labelForStage,
  stageNoteSummary,
  suggestStage,
  type ApprovalRef,
  type CommentRef,
  type StageRef,
} from "../services/approvals.js";

/**
 * Phase 6 · the team.
 *
 * Approval is an act with a person and a time behind it, and sending work back
 * is an act that has to say why. The old Review Queue had neither: its Approve
 * button 400'd by design and the server stripped the comment on the way past.
 *
 * Two invariants this route exists to hold, both of them things the surrounding
 * system already got right and which are easy to break from here:
 *
 *  - **Approving schedules. It never publishes.** No calendar entry is touched,
 *    no social account is reached. Publishing stays where it is.
 *  - **Sending back records; it does not reopen.** §1.5 says reopening is
 *    consent. The reason lands on the causing stage and waits there.
 */

const router: IRouter = Router();

function viewer(req: Request): { id: string; role: string } {
  const u = req.user as { id?: string; role?: string } | undefined;
  return { id: u?.id ?? "", role: u?.role ?? "viewer" };
}

async function stagesOf(creativeId: string): Promise<StageRef[]> {
  const rows = await db
    .select({
      id: stageStatesTable.id,
      stageNumber: stageStatesTable.stageNumber,
      stageKind: stageStatesTable.stageKind,
      status: stageStatesTable.status,
    })
    .from(stageStatesTable)
    .where(eq(stageStatesTable.creativeId, creativeId));
  return rows as StageRef[];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

async function loadState(creativeId: string, me: { id: string; role: string }) {
  const [approvals, comments, stages] = await Promise.all([
    db.select().from(approvalsTable)
      .where(eq(approvalsTable.creativeId, creativeId))
      .orderBy(desc(approvalsTable.requestedAt)),
    db.select({
      id: commentsTable.id,
      stageStateId: commentsTable.stageStateId,
      slotKey: commentsTable.slotKey,
      body: commentsTable.body,
      authorId: commentsTable.authorId,
      authorName: usersTable.name,
      createdAt: commentsTable.createdAt,
      resolvedAt: commentsTable.resolvedAt,
    })
      .from(commentsTable)
      .leftJoin(usersTable, eq(commentsTable.authorId, usersTable.id))
      .where(eq(commentsTable.creativeId, creativeId)),
    stagesOf(creativeId),
  ]);

  const approvalRefs: ApprovalRef[] = approvals.map(a => ({
    id: a.id,
    requestedBy: a.requestedBy,
    requestedAt: a.requestedAt.toISOString(),
    decidedBy: a.decidedBy,
    decidedAt: iso(a.decidedAt),
    decision: a.decision,
    rejectReason: a.rejectReason,
    rejectStageStateId: a.rejectStageStateId,
    note: a.note,
  }));

  const commentRefs: (CommentRef & { authorName: string | null })[] = comments.map(x => ({
    id: x.id,
    stageStateId: x.stageStateId,
    slotKey: x.slotKey,
    body: x.body,
    authorId: x.authorId,
    authorName: x.authorName,
    createdAt: x.createdAt.toISOString(),
    resolvedAt: iso(x.resolvedAt),
  }));

  return { approvalRefs, commentRefs, stages, status: approvalStatus(approvalRefs, me.id, me.role) };
}

/**
 * Everything the Studio needs to show the team layer, in one read.
 *
 * Including what this person MAY DO, in words. A viewer who sees a dead button
 * and no explanation concludes the product is broken; one line costs nothing
 * and is the whole difference.
 */
router.get("/creatives/:creativeId/team", async (req: Request, res: Response): Promise<void> => {
  const creativeId = String(req.params.creativeId);
  const me = viewer(req);
  try {
    const [creative] = await db
      .select({ id: creativesTable.id, status: creativesTable.status })
      .from(creativesTable)
      .where(eq(creativesTable.id, creativeId));
    if (!creative) {
      res.status(404).json({ error: "Creative not found" });
      return;
    }

    const { approvalRefs, commentRefs, stages, status } = await loadState(creativeId, me);

    // Notes grouped per stage, so a stage can show what is waiting on it
    // without the client re-deriving the rule.
    const byStage = Object.fromEntries(
      stages.map(s => {
        const { open, resolved } = commentsForStage(commentRefs, s.id);
        return [s.id, { open, resolved, summary: stageNoteSummary(open) }];
      }),
    );

    res.json({
      creativeStatus: creative.status,
      approval: status,
      approvals: approvalRefs,
      comments: commentRefs,
      commentsByStage: byStage,
      // Creative-wide notes belong to nobody's stage and would otherwise vanish.
      creativeComments: commentRefs.filter(c => !c.stageStateId),
      stages: assignableStages(stages).map(s => ({ ...s, label: labelForStage(s.stageKind) })),
      taxonomy: REJECT_CATEGORIES,
      you: {
        id: me.id,
        role: me.role,
        canDecide: canDecide(me.role),
        canRequest: canRequest(me.role),
        canComment: canComment(me.role),
        explanation: describeRole(me.role),
      },
    });
  } catch (err) {
    console.error("Failed to read the team state", err);
    res.status(500).json({ error: "The approval state could not be read." });
  }
});

/**
 * Every creative currently waiting on a decision, in one query.
 *
 * The Pipeline shows a week of cards and needs to mark the ones waiting on the
 * person looking. Asking per card would be one request per card on a page that
 * already loads entries, creatives and thumbnails, so this answers for all of
 * them at once.
 *
 * `needsYou` is computed here rather than left to the client, so the rule that
 * you are not blocked by your own request lives in exactly one place.
 */
router.get("/approvals/awaiting", async (req: Request, res: Response): Promise<void> => {
  const me = viewer(req);
  try {
    const rows = await db
      .select({
        creativeId: approvalsTable.creativeId,
        requestedBy: approvalsTable.requestedBy,
        requestedAt: approvalsTable.requestedAt,
        requestedByName: usersTable.name,
        // The Review Queue renders these rows as cards, and a card that only
        // says an id is a card nobody can act on (doc 40 P0.2: the queue read
        // creative.status and showed PENDING 0 while requests sat here).
        creativeName: creativesTable.name,
        brandId: creativesTable.brandId,
      })
      .from(approvalsTable)
      .leftJoin(usersTable, eq(approvalsTable.requestedBy, usersTable.id))
      .leftJoin(creativesTable, eq(approvalsTable.creativeId, creativesTable.id))
      .where(isNull(approvalsTable.decidedAt));

    res.json({
      data: rows.map(r => ({
        creativeId: r.creativeId,
        creativeName: r.creativeName,
        brandId: r.brandId,
        requestedBy: r.requestedBy,
        requestedByName: r.requestedByName,
        requestedAt: r.requestedAt.toISOString(),
        needsYou: canDecide(me.role) && r.requestedBy !== me.id,
      })),
      you: { id: me.id, role: me.role, canDecide: canDecide(me.role) },
    });
  } catch (err) {
    console.error("Failed to read what is awaiting a decision", err);
    res.status(500).json({ error: "Pending decisions could not be read." });
  }
});

/** What stage a reason would be pointed at, before anyone commits to it. */
router.get("/creatives/:creativeId/team/suggest", async (req: Request, res: Response): Promise<void> => {
  const creativeId = String(req.params.creativeId);
  const reason = String(req.query.reason ?? "");
  try {
    res.json(suggestStage(reason, await stagesOf(creativeId)));
  } catch (err) {
    console.error("Failed to suggest a stage", err);
    res.status(500).json({ error: "A stage could not be suggested." });
  }
});

router.post(
  "/creatives/:creativeId/approvals",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const me = viewer(req);
    try {
      if (!canRequest(me.role)) {
        res.status(403).json({ error: describeRole(me.role) });
        return;
      }
      const [creative] = await db.select({ id: creativesTable.id }).from(creativesTable).where(eq(creativesTable.id, creativeId));
      if (!creative) {
        res.status(404).json({ error: "Creative not found" });
        return;
      }

      // An open request already exists: asking twice is not two questions.
      const [open] = await db
        .select({ id: approvalsTable.id })
        .from(approvalsTable)
        // isNull, not eq(..., null). `= NULL` is never true in SQL, so an
        // equality test here would let open requests stack up silently.
        .where(and(eq(approvalsTable.creativeId, creativeId), isNull(approvalsTable.decidedAt)));
      if (open) {
        res.status(409).json({ error: "This is already waiting on a decision, so nothing was added." });
        return;
      }

      const [created] = await db
        .insert(approvalsTable)
        .values({ creativeId, requestedBy: me.id })
        .returning({ id: approvalsTable.id });
      await recordAudit({
        actor: actorFromRequest(req),
        action: "approval.requested",
        entityType: "creative",
        entityIds: [creativeId],
        metadata: { approvalId: created!.id },
      });

      const state = await loadState(creativeId, me);
      res.json({ ok: true, approval: state.status });
    } catch (err) {
      console.error("Failed to request a decision", err);
      res.status(500).json({ error: "The request could not be made." });
    }
  },
);

const DecideBody = z.object({
  decision: z.enum(["approved", "needs_work"]),
  reason: z.string().nullable().optional(),
  stageStateId: z.string().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

router.post(
  "/creatives/:creativeId/approvals/:approvalId/decide",
  requireStandardWrite,
  validateRequest({ body: DecideBody }),
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const approvalId = String(req.params.approvalId);
    const me = viewer(req);
    const body = req.body as z.infer<typeof DecideBody>;

    try {
      if (!canDecide(me.role)) {
        res.status(403).json({ error: describeRole(me.role) });
        return;
      }

      const [approval] = await db
        .select()
        .from(approvalsTable)
        .where(and(eq(approvalsTable.id, approvalId), eq(approvalsTable.creativeId, creativeId)));
      if (!approval) {
        res.status(404).json({ error: "No such request on this creative." });
        return;
      }
      if (approval.decidedAt) {
        // 409 rather than 403: the permission is fine, the resource state
        // refuses the write. Same reasoning as the stage lock guard.
        res.status(409).json({ error: "This was already decided, so nothing changed." });
        return;
      }

      /*
       * Validated here as well as by the database CHECKs. The constraints are
       * the last line and they throw a Postgres error; this is the line that
       * produces a sentence somebody can act on.
       */
      const checked = checkDecision(body, await stagesOf(creativeId));
      if (!checked.ok) {
        res.status(400).json({ error: checked.error });
        return;
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(approvalsTable)
          .set({
            decidedBy: me.id,
            decidedAt: now,
            decision: checked.decision,
            rejectReason: checked.reason,
            rejectStageStateId: checked.stageStateId,
            note: checked.note,
          })
          .where(eq(approvalsTable.id, approvalId));

        /*
         * The creative moves, and NOTHING ELSE moves.
         *
         * Approving sets `scheduled`; it does not create a calendar entry, does
         * not touch a social account and does not publish. Sending back sets
         * `draft`; it deliberately does not reopen, stale or alter any stage,
         * because reopening is consent (§1.5) and taking that choice away would
         * silently invalidate work downstream.
         */
        await tx
          .update(creativesTable)
          .set({ status: creativeStatusAfter(checked.decision), updatedAt: now })
          .where(eq(creativesTable.id, creativeId));

        /*
         * A rejection with a note becomes a COMMENT on the causing stage too.
         *
         * The approval row is the record of the decision; the comment is what
         * is actually waiting for the person who reopens that stage. Without
         * this the reason is in a table nobody reads at the moment they need it.
         */
        if (checked.decision === "needs_work" && checked.stageStateId && checked.note) {
          await tx.insert(commentsTable).values({
            creativeId,
            stageStateId: checked.stageStateId,
            authorId: me.id,
            body: checked.note,
          });
        }
      });

      await recordAudit({
        actor: actorFromRequest(req),
        action: `approval.${checked.decision}`,
        entityType: "creative",
        entityIds: [creativeId],
        metadata: { approvalId, reason: checked.reason, stageStateId: checked.stageStateId },
      });

      const state = await loadState(creativeId, me);
      res.json({ ok: true, approval: state.status, creativeStatus: creativeStatusAfter(checked.decision) });
    } catch (err) {
      console.error("Failed to decide", err);
      res.status(500).json({ error: "The decision could not be saved." });
    }
  },
);

const CommentBody = z.object({
  body: z.string().min(1).max(2000),
  stageStateId: z.string().nullable().optional(),
  slotKey: z.string().nullable().optional(),
});

router.post(
  "/creatives/:creativeId/comments",
  requireStandardWrite,
  validateRequest({ body: CommentBody }),
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const me = viewer(req);
    const { body, stageStateId, slotKey } = req.body as z.infer<typeof CommentBody>;

    try {
      if (!body.trim()) {
        res.status(400).json({ error: "An empty note is not a note, so nothing was saved." });
        return;
      }
      if (stageStateId) {
        const stages = await stagesOf(creativeId);
        if (!stages.some(s => s.id === stageStateId)) {
          res.status(400).json({ error: "That stage is not on this creative, so nothing was saved." });
          return;
        }
      }
      await db.insert(commentsTable).values({
        creativeId,
        stageStateId: stageStateId ?? null,
        slotKey: slotKey ?? null,
        authorId: me.id,
        body: body.trim(),
      });
      const state = await loadState(creativeId, me);
      res.json({ ok: true, comments: state.commentRefs });
    } catch (err) {
      console.error("Failed to add a note", err);
      res.status(500).json({ error: "The note could not be saved." });
    }
  },
);

router.post(
  "/creatives/:creativeId/comments/:commentId/resolve",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const commentId = String(req.params.commentId);
    const me = viewer(req);
    try {
      const [existing] = await db
        .select({ id: commentsTable.id, resolvedAt: commentsTable.resolvedAt })
        .from(commentsTable)
        .where(and(eq(commentsTable.id, commentId), eq(commentsTable.creativeId, creativeId)));
      if (!existing) {
        res.status(404).json({ error: "No such note on this creative." });
        return;
      }
      // Resolving an already-resolved note is a no-op, not a failure: a double
      // click should not be an error, and it must not move the original time.
      if (!existing.resolvedAt) {
        await db
          .update(commentsTable)
          .set({ resolvedAt: new Date(), resolvedBy: me.id })
          .where(eq(commentsTable.id, commentId));
      }
      const state = await loadState(creativeId, me);
      res.json({ ok: true, comments: state.commentRefs });
    } catch (err) {
      console.error("Failed to resolve a note", err);
      res.status(500).json({ error: "The note could not be resolved." });
    }
  },
);

export default router;
