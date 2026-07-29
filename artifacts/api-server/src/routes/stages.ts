import { Router, type IRouter } from "express";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  stageStatesTable,
  stageTakesTable,
  creativesTable,
  STAGE_ORDER,
  STAGE_MODES,
  TAKE_ORIGINS,
} from "@workspace/db";
import {
  planReopen,
  dependencyEdge,
  shouldAutoLock,
  nextTakeIndex,
  initialSpine,
  describeReopen,
  type StageNode,
} from "../services/stage-graph.js";

/**
 * The spine API.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.1 to §1.5
 *
 * This layer is deliberately thin. Every decision about staleness, locking and
 * dependency lives in services/stage-graph.ts, which is pure and has 63
 * executable assertions behind it. Routes read rows, hand plain objects to the
 * engine, and write back what it decided.
 *
 * The rule that shapes the endpoint design: REOPENING IS A TWO-STEP. A GET-like
 * preview returns what would happen, and a separate confirm applies it. That is
 * what makes "keep them as they are" possible, and it is why nothing here
 * regenerates anything.
 */

const router: IRouter = Router();

/** Rows from the DB, narrowed to what the engine needs. */
function toNodes(rows: Array<typeof stageStatesTable.$inferSelect>): StageNode[] {
  return rows.map((r) => ({
    id: r.id,
    stageNumber: r.stageNumber,
    stageKind: r.stageKind,
    status: r.status,
    // The column is typed and CHECK-constrained, but the engine coerces
    // defensively anyway; see asIdList there.
    consumedFrom: r.consumedFrom ?? [],
  }));
}

async function loadSpine(creativeId: string) {
  return db
    .select()
    .from(stageStatesTable)
    .where(eq(stageStatesTable.creativeId, creativeId))
    .orderBy(asc(stageStatesTable.stageNumber));
}

/**
 * Create the five stages for a creative if they do not exist yet.
 *
 * Idempotent by the (creative_id, stage_number) unique constraint: a race
 * between two callers ends with one insert and one no-op rather than ten rows.
 */
async function ensureSpine(creativeId: string) {
  const existing = await loadSpine(creativeId);
  if (existing.length === STAGE_ORDER.length) return existing;

  await db
    .insert(stageStatesTable)
    .values(
      initialSpine().map((s) => ({
        creativeId,
        stageNumber: s.stageNumber,
        stageKind: s.stageKind,
        status: s.status,
        consumedFrom: s.consumedFrom,
      })),
    )
    .onConflictDoNothing();

  return loadSpine(creativeId);
}

/**
 * GET the spine, its takes, and the arrow direction between each adjacent pair.
 *
 * Arrows come from the engine rather than being inferred in the component, so
 * there is one source of truth for what the graph actually says. This is what
 * renders reversed for a copy-led post.
 */
router.get("/creatives/:creativeId/stages", async (req, res): Promise<void> => {
  const creativeId = String(req.params.creativeId);
  try {
    const [creative] = await db
      .select({ id: creativesTable.id })
      .from(creativesTable)
      .where(eq(creativesTable.id, creativeId));
    if (!creative) {
      res.status(404).json({ error: "Creative not found" });
      return;
    }

    const rows = await ensureSpine(creativeId);
    const nodes = toNodes(rows);

    const takes = await db
      .select()
      .from(stageTakesTable)
      .innerJoin(stageStatesTable, eq(stageTakesTable.stageStateId, stageStatesTable.id))
      .where(eq(stageStatesTable.creativeId, creativeId))
      .orderBy(asc(stageTakesTable.takeIndex));

    const takesByStage: Record<string, Array<typeof stageTakesTable.$inferSelect>> = {};
    for (const row of takes) {
      const t = row.stage_takes;
      (takesByStage[t.stageStateId] ??= []).push(t);
    }

    const edges = nodes.slice(0, -1).map((n, i) => ({
      from: n.id,
      to: nodes[i + 1].id,
      direction: dependencyEdge(n, nodes[i + 1]),
    }));

    res.json({ stages: rows, takes: takesByStage, edges });
  } catch (err) {
    console.error("Failed to load spine", err);
    res.status(500).json({ error: "Failed to load stages" });
  }
});

/**
 * PREVIEW a reopen. Changes nothing.
 *
 * Deliberately a GET: it is safe, repeatable, and the UI calls it just to
 * decide whether to show the "re-run or keep" bar at all.
 */
router.get("/creatives/:creativeId/stages/:stageId/reopen-preview", async (req, res): Promise<void> => {
  const creativeId = String(req.params.creativeId);
  const stageId = String(req.params.stageId);
  try {
    const rows = await loadSpine(creativeId);
    const nodes = toNodes(rows);
    if (!nodes.some((n) => n.id === stageId)) {
      res.status(404).json({ error: "Stage not found on this creative" });
      return;
    }
    const plan = planReopen(nodes, stageId);
    res.json({ plan, summary: describeReopen(plan, nodes) });
  } catch (err) {
    console.error("Failed to plan reopen", err);
    res.status(500).json({ error: "Failed to plan reopen" });
  }
});

const reopenBody = z.object({
  /**
   * false is the "keep them as they are" path: the stage reopens and
   * downstream work is left exactly as it is. Defaulting to false is
   * deliberate, so a caller that forgets the flag cannot destroy work.
   */
  markDownstreamStale: z.boolean().default(false),
  mode: z.enum(STAGE_MODES).optional(),
});

/**
 * APPLY a reopen.
 *
 * Note what this does NOT do: it never regenerates anything. Marking a stage
 * stale records that it was built on something that has since changed. Choosing
 * to re-run is a separate, explicit action per §1.5.
 */
router.post("/creatives/:creativeId/stages/:stageId/reopen", async (req, res): Promise<void> => {
  const creativeId = String(req.params.creativeId);
  const stageId = String(req.params.stageId);

  const parsed = reopenBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  try {
    const rows = await loadSpine(creativeId);
    const nodes = toNodes(rows);
    const target = nodes.find((n) => n.id === stageId);
    if (!target) {
      res.status(404).json({ error: "Stage not found on this creative" });
      return;
    }

    const plan = planReopen(nodes, stageId);

    // A locked stage is an input to everything downstream. Reopening it without
    // unlocking first would quietly contradict that, so refuse and say why.
    if (plan.targetLocked) {
      res.status(409).json({
        error: "This stage is locked. Unlock it before reopening.",
        plan,
      });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(stageStatesTable)
        .set({ status: "active", mode: parsed.data.mode ?? "explore", updatedAt: new Date() })
        .where(eq(stageStatesTable.id, stageId));

      if (parsed.data.markDownstreamStale) {
        for (const item of plan.stale) {
          await tx
            .update(stageStatesTable)
            .set({ status: "stale", supersededReason: item.reason, updatedAt: new Date() })
            .where(eq(stageStatesTable.id, item.id));
        }
      }
    });

    res.json({
      plan,
      applied: parsed.data.markDownstreamStale,
      summary: describeReopen(plan, nodes),
    });
  } catch (err) {
    console.error("Failed to reopen stage", err);
    res.status(500).json({ error: "Failed to reopen stage" });
  }
});

const lockBody = z.object({ locked: z.boolean() });

/** Lock or unlock a stage. A locked stage becomes an input to every other. */
router.post("/creatives/:creativeId/stages/:stageId/lock", async (req, res): Promise<void> => {
  const creativeId = String(req.params.creativeId);
  const stageId = String(req.params.stageId);

  const parsed = lockBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  try {
    const [updated] = await db
      .update(stageStatesTable)
      .set(
        parsed.data.locked
          ? {
              status: "locked",
              // The locked_at CHECK requires this, so it is set together rather
              // than left to a caller to remember.
              lockedAt: new Date(),
              lockedBy: (req as { user?: { id?: string } }).user?.id ?? null,
              updatedAt: new Date(),
            }
          : { status: "done", lockedAt: null, lockedBy: null, updatedAt: new Date() },
      )
      .where(and(eq(stageStatesTable.id, stageId), eq(stageStatesTable.creativeId, creativeId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Stage not found on this creative" });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error("Failed to change lock", err);
    res.status(500).json({ error: "Failed to change lock" });
  }
});

const takeBody = z.object({
  slotKey: z.string().min(1).max(64),
  origin: z.enum(TAKE_ORIGINS).default("generated"),
  payload: z.unknown(),
  /** Ids of the stages this take consumed. Recorded, never inferred. */
  consumedFrom: z.array(z.string()).default([]),
  costCents: z.number().int().min(0).optional(),
});

/**
 * Record a take against a slot.
 *
 * Three things happen together, which is why it is one transaction:
 * the new take becomes current and every sibling stops being current; the
 * stage records what it consumed, so the dependency graph stays truthful; and
 * hand-typed content auto-locks the stage so an upstream re-run cannot later
 * destroy it.
 */
router.post("/creatives/:creativeId/stages/:stageId/takes", async (req, res): Promise<void> => {
  const creativeId = String(req.params.creativeId);
  const stageId = String(req.params.stageId);

  const parsed = takeBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;

  try {
    const [stage] = await db
      .select()
      .from(stageStatesTable)
      .where(and(eq(stageStatesTable.id, stageId), eq(stageStatesTable.creativeId, creativeId)));
    if (!stage) {
      res.status(404).json({ error: "Stage not found on this creative" });
      return;
    }

    /**
     * A locked stage cannot be written to. Principle 1.4: a locked stage stops
     * being an output and becomes an input to every other stage. Without this
     * guard the lock is advisory, enforced only by a disabled textarea in one
     * client, and any other caller can rewrite a locked brief. The damage is not
     * just the overwrite: downstream stages that consumed it are left stale in
     * fact but "done" in the record, because staleness is marked by the reopen
     * ceremony (§1.5, reopening is consent) which such a caller skipped.
     *
     * 409 rather than 403: nothing is wrong with the caller's permissions, the
     * resource is in a state that refuses the write. Unlock, or reopen, first.
     */
    if (stage.status === "locked") {
      res.status(409).json({
        error:
          "This stage is locked, so it was not changed. Unlock it first, which lets you choose what happens to the stages that used it.",
        stageStatus: "locked",
      });
      return;
    }


    const created = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ slotKey: stageTakesTable.slotKey, takeIndex: stageTakesTable.takeIndex })
        .from(stageTakesTable)
        .where(eq(stageTakesTable.stageStateId, stageId));

      // Clear the current flag first: the partial unique index allows only one
      // current take per slot, so inserting before clearing would collide.
      await tx
        .update(stageTakesTable)
        .set({ isCurrent: false })
        .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.slotKey, body.slotKey)));

      const [take] = await tx
        .insert(stageTakesTable)
        .values({
          stageStateId: stageId,
          slotKey: body.slotKey,
          takeIndex: nextTakeIndex(existing, body.slotKey),
          origin: body.origin,
          payload: body.payload ?? null,
          isCurrent: true,
          authoredBy: (req as { user?: { id?: string } }).user?.id ?? null,
          costCents: body.costCents ?? null,
        })
        .returning();

      // Merge rather than replace, so a stage that consumed several inputs over
      // several takes keeps all of its edges.
      const merged = new Set([...(stage.consumedFrom ?? []), ...body.consumedFrom]);
      merged.delete(stageId);

      const autoLock = shouldAutoLock(body.origin);
      await tx
        .update(stageStatesTable)
        .set({
          consumedFrom: [...merged],
          status: autoLock ? "locked" : stage.status === "locked" ? "locked" : "done",
          ...(autoLock && stage.status !== "locked"
            ? { lockedAt: new Date(), lockedBy: (req as { user?: { id?: string } }).user?.id ?? null }
            : {}),
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stageStatesTable.id, stageId));

      return { take, autoLocked: autoLock };
    });

    res.status(201).json(created);
  } catch (err) {
    console.error("Failed to record take", err);
    res.status(500).json({ error: "Failed to record take" });
  }
});

export default router;
