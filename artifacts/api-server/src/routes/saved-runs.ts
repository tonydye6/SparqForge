/**
 * Phase 10 · saved runs and cross-brand fan-out.
 *
 * Doc 22 Phase 10 items 2 and 3. Every decision about what crosses a brand
 * boundary lives in services/saved-runs.ts, pure and tested; this file is the
 * transaction around those decisions and nothing more.
 *
 * TWO THINGS THIS LAYER OWES THE USER.
 *
 * **The preview is free and comes first.** `GET /saved-runs/:id` returns, per
 * target brand, exactly what a run would and would not carry. Doc 24 §8 is the
 * test: show the consequence before the act. It is the same idea as the reopen
 * preview on the spine, and it costs nothing because replaying costs nothing.
 *
 * **Replaying never generates.** It writes takes somebody already paid for and
 * re-derives the brand rows deterministically. A cross-brand replay lands with
 * its Image stage EMPTY on purpose: making that picture is what the target
 * brand's own contract is for, and quietly reusing the other brand's picture
 * would be the failure Principle 1.9 exists to prevent.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  brandsTable,
  creativesTable,
  savedRunBrandsTable,
  savedRunsTable,
  socialAccountsTable,
  stageStatesTable,
  stageTakesTable,
  type StageKind,
} from "@workspace/db";
import { str } from "../lib/http-params.js";
import { constraintOf } from "../lib/db-errors.js";
import { recordAudit, actorFromRequest } from "../lib/audit.js";
import { requireStandardWrite, requireDestructive } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate.js";
import { initialSpine } from "../services/stage-graph.js";
import {
  captureSnapshot,
  planReplay,
  replayability,
  type CaptureStage,
  type ReplayPlan,
  type ReplayTarget,
} from "../services/saved-runs.js";

const router: IRouter = Router();

function userId(req: Request): string | null {
  return (req as { user?: { id?: string } }).user?.id ?? null;
}

/**
 * Everything a replay needs to know about one brand, read live.
 *
 * Live rather than snapshotted, because a saved run outlives the record it was
 * captured against: connect a TikTok account and last month's run must not
 * still be saying the brand cannot publish there.
 */
async function loadTargets(brandIds: string[]): Promise<Map<string, ReplayTarget>> {
  const out = new Map<string, ReplayTarget>();
  if (brandIds.length === 0) return out;

  const brands = await db.select().from(brandsTable).where(inArray(brandsTable.id, brandIds));
  const accounts = await db
    .select({ brandId: socialAccountsTable.brandId, platform: socialAccountsTable.platform })
    .from(socialAccountsTable)
    .where(and(inArray(socialAccountsTable.brandId, brandIds), eq(socialAccountsTable.status, "connected")));

  for (const brand of brands) {
    out.set(brand.id, {
      brandId: brand.id,
      brandName: brand.name,
      connectedPlatforms: accounts.filter((a) => a.brandId === brand.id).map((a) => a.platform),
      constraints: {
        bannedTerms: brand.bannedTerms,
        negativePrompt: brand.negativePrompt,
        trademarkRules: brand.trademarkRules,
      },
    });
  }
  return out;
}

async function targetIdsFor(savedRunId: string): Promise<string[]> {
  const rows = await db
    .select({ brandId: savedRunBrandsTable.brandId })
    .from(savedRunBrandsTable)
    .where(eq(savedRunBrandsTable.savedRunId, savedRunId));
  return rows.map((r) => r.brandId);
}

// ── list ─────────────────────────────────────────────────────────────────────

router.get("/saved-runs", async (_req: Request, res: Response): Promise<void> => {
  try {
    const runs = await db.select().from(savedRunsTable).orderBy(desc(savedRunsTable.createdAt)).limit(100);
    if (runs.length === 0) {
      res.json({ runs: [] });
      return;
    }

    const links = await db
      .select({ savedRunId: savedRunBrandsTable.savedRunId, brandId: savedRunBrandsTable.brandId, brandName: brandsTable.name })
      .from(savedRunBrandsTable)
      .innerJoin(brandsTable, eq(savedRunBrandsTable.brandId, brandsTable.id))
      .where(inArray(savedRunBrandsTable.savedRunId, runs.map((r) => r.id)));

    res.json({
      runs: runs.map((run) => {
        const can = replayability(run.templateSnapshot);
        return {
          id: run.id,
          name: run.name,
          sourceCreativeId: run.sourceCreativeId,
          lockedStages: run.lockedStages ?? [],
          runCount: run.runCount,
          lastRunAt: run.lastRunAt,
          createdAt: run.createdAt,
          brands: links.filter((l) => l.savedRunId === run.id).map((l) => ({ id: l.brandId, name: l.brandName })),
          replayable: can.ok,
          // Named rather than hidden, so a run this build cannot replay reads as
          // a reason in the list instead of a button that does nothing.
          blockedReason: can.reason ?? null,
        };
      }),
    });
  } catch (err) {
    console.error("Failed to list saved runs", err);
    res.status(500).json({ error: "The saved runs could not be loaded." });
  }
});

// ── detail, with the free preview ────────────────────────────────────────────

router.get("/saved-runs/:id", async (req: Request, res: Response): Promise<void> => {
  const id = str(req.params.id);
  try {
    const [run] = await db.select().from(savedRunsTable).where(eq(savedRunsTable.id, id));
    if (!run) {
      res.status(404).json({ error: "That saved run no longer exists." });
      return;
    }

    const brandIds = await targetIdsFor(id);
    const targets = await loadTargets(brandIds);
    const can = replayability(run.templateSnapshot);

    const previews = brandIds
      .map((brandId) => targets.get(brandId))
      .filter((t): t is ReplayTarget => Boolean(t))
      .map((target) => {
        const plan: ReplayPlan = planReplay(run.templateSnapshot, target);
        return {
          brandId: target.brandId,
          brandName: target.brandName,
          crossBrand: plan.crossBrand,
          // The stages that will land with content, in reading order.
          willCarry: plan.stages.map((s) => ({ stageNumber: s.stageNumber, stageKind: s.stageKind, locked: s.lock })),
          notes: plan.notes,
        };
      });

    res.json({
      run: {
        id: run.id,
        name: run.name,
        sourceCreativeId: run.sourceCreativeId,
        sourceBrandId: run.templateSnapshot?.sourceBrandId ?? null,
        lockedStages: run.lockedStages ?? [],
        runCount: run.runCount,
        lastRunAt: run.lastRunAt,
        replayable: can.ok,
        blockedReason: can.reason ?? null,
      },
      previews,
    });
  } catch (err) {
    console.error("Failed to load a saved run", err);
    res.status(500).json({ error: "That saved run could not be loaded." });
  }
});

// ── capture ──────────────────────────────────────────────────────────────────

const CaptureBody = z.object({
  name: z.string().trim().min(1).max(120),
  /** Extra brands to fan out to. The creative's own brand is always included. */
  brandIds: z.array(z.string()).max(12).default([]),
});

router.post(
  "/creatives/:creativeId/saved-runs",
  requireStandardWrite,
  validateRequest({ body: CaptureBody }),
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = str(req.params.creativeId);
    const body = req.body as z.infer<typeof CaptureBody>;

    try {
      const [creative] = await db
        .select({ id: creativesTable.id, brandId: creativesTable.brandId })
        .from(creativesTable)
        .where(eq(creativesTable.id, creativeId));
      if (!creative) {
        res.status(404).json({ error: "That post no longer exists." });
        return;
      }

      const stageRows = await db
        .select()
        .from(stageStatesTable)
        .where(eq(stageStatesTable.creativeId, creativeId));
      const takeRows = stageRows.length
        ? await db
            .select()
            .from(stageTakesTable)
            .where(inArray(stageTakesTable.stageStateId, stageRows.map((s) => s.id)))
        : [];

      const stages: CaptureStage[] = stageRows.map((s) => ({
        id: s.id,
        stageNumber: s.stageNumber,
        stageKind: s.stageKind,
        status: s.status,
        consumedFrom: s.consumedFrom ?? [],
        takes: takeRows
          .filter((t) => t.stageStateId === s.id)
          .map((t) => ({ slotKey: t.slotKey, origin: t.origin, payload: t.payload, isCurrent: t.isCurrent })),
      }));

      const captured = captureSnapshot(stages, creative.brandId);
      if (captured.problems.length > 0) {
        res.status(400).json({ error: captured.problems[0] });
        return;
      }

      // The brand this came from is always a target, so a saved run is never
      // born with nowhere to run. Deduped, because asking for it explicitly is
      // reasonable and must not become a primary-key collision.
      const brandIds = [...new Set([creative.brandId, ...body.brandIds])];
      const known = await loadTargets(brandIds);
      const missing = brandIds.filter((b) => !known.has(b));
      if (missing.length > 0) {
        res.status(400).json({ error: "One of the brands chosen no longer exists." });
        return;
      }

      const created = await db.transaction(async (tx) => {
        const [run] = await tx
          .insert(savedRunsTable)
          .values({
            name: body.name.trim(),
            sourceCreativeId: creativeId,
            lockedStages: captured.lockedStages,
            templateSnapshot: captured.snapshot,
            createdBy: userId(req),
          })
          .returning();
        // Same transaction, which is what the deferred trigger is for: the run
        // and its targets land together or neither does.
        await tx.insert(savedRunBrandsTable).values(brandIds.map((brandId) => ({ savedRunId: run!.id, brandId })));
        return run!;
      });

      await recordAudit({
        actor: actorFromRequest(req),
        action: "saved_run.created",
        entityType: "saved_run",
        entityIds: [created.id],
        metadata: { creativeId, brandIds, lockedStages: captured.lockedStages },
      });

      res.status(201).json({ id: created.id, name: created.name, lockedStages: created.lockedStages });
    } catch (err) {
      if (constraintOf(err) === "saved_runs_require_target") {
        res.status(400).json({ error: "A run needs at least one brand to run for." });
        return;
      }
      console.error("Failed to save a run", err);
      res.status(500).json({ error: "The run could not be saved." });
    }
  },
);

// ── run it ───────────────────────────────────────────────────────────────────

const RunBody = z.object({
  /** Optional subset of the run's brands. Omitted means all of them. */
  brandIds: z.array(z.string()).max(12).optional(),
});

/**
 * Write one replayed post.
 *
 * The whole spine and all of its takes land in ONE transaction. A half-written
 * replay would be worse than none: a spine claiming a locked Copy stage with no
 * take in it is a state no screen can render honestly, and nothing here is
 * expensive enough to be worth resuming.
 */
async function writeReplay(
  plan: ReplayPlan,
  opts: { name: string; briefLine: string | null; createdBy: string | null },
): Promise<{ creativeId: string }> {
  return db.transaction(async (tx) => {
    const [creative] = await tx
      .insert(creativesTable)
      .values({
        brandId: plan.brandId,
        name: opts.name,
        status: "draft",
        // Set so the legacy surfaces, which read briefText rather than stages,
        // show the idea instead of an empty row.
        briefText: opts.briefLine,
        createdBy: opts.createdBy ?? "system",
      })
      .returning({ id: creativesTable.id });

    const spineRows = await tx
      .insert(stageStatesTable)
      .values(
        initialSpine().map((s) => ({
          creativeId: creative!.id,
          stageNumber: s.stageNumber,
          stageKind: s.stageKind,
          status: s.status,
          consumedFrom: s.consumedFrom,
        })),
      )
      .returning();

    const idByKind = new Map<StageKind, string>(spineRows.map((s) => [s.stageKind, s.id]));

    for (const stage of plan.stages) {
      const stageId = idByKind.get(stage.stageKind);
      if (!stageId) continue;

      let index = 1;
      for (const slot of stage.slots) {
        await tx.insert(stageTakesTable).values({
          stageStateId: stageId,
          slotKey: slot.slotKey,
          takeIndex: index++,
          origin: slot.origin,
          payload: slot.payload ?? null,
          isCurrent: true,
          authoredBy: opts.createdBy,
        });
      }

      const consumed = stage.consumedFromKinds
        .map((k) => idByKind.get(k))
        .filter((id): id is string => Boolean(id));

      await tx
        .update(stageStatesTable)
        .set({
          consumedFrom: consumed,
          status: stage.lock ? "locked" : "done",
          // The locked CHECK requires this, so it is set with the status rather
          // than left to a caller to remember.
          ...(stage.lock ? { lockedAt: new Date(), lockedBy: opts.createdBy } : {}),
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stageStatesTable.id, stageId));
    }

    return { creativeId: creative!.id };
  });
}

/** The typed line, dug out of the brief slot so a replayed post has a name. */
function briefLineOf(plan: ReplayPlan): string | null {
  const brief = plan.stages.find((s) => s.stageKind === "brief");
  const payload = brief?.slots.find((s) => s.slotKey === "brief")?.payload as { line?: unknown } | undefined;
  return typeof payload?.line === "string" && payload.line.trim() ? payload.line.trim() : null;
}

router.post(
  "/saved-runs/:id/run",
  requireStandardWrite,
  validateRequest({ body: RunBody }),
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const body = req.body as z.infer<typeof RunBody>;

    try {
      const [run] = await db.select().from(savedRunsTable).where(eq(savedRunsTable.id, id));
      if (!run) {
        res.status(404).json({ error: "That saved run no longer exists." });
        return;
      }

      const can = replayability(run.templateSnapshot);
      if (!can.ok) {
        res.status(409).json({ error: can.reason });
        return;
      }

      const all = await targetIdsFor(id);
      const chosen = body.brandIds?.length ? all.filter((b) => body.brandIds!.includes(b)) : all;
      if (chosen.length === 0) {
        res.status(400).json({ error: "Choose at least one brand to run this for." });
        return;
      }

      const targets = await loadTargets(chosen);
      const results: Array<{ brandId: string; brandName: string; creativeId: string; notes: ReplayPlan["notes"] }> = [];

      for (const brandId of chosen) {
        const target = targets.get(brandId);
        if (!target) continue;
        const plan = planReplay(run.templateSnapshot, target);
        const line = briefLineOf(plan);
        // The brand only enters the name when there is more than one, because a
        // single-brand replay does not need to be told which brand it is in.
        const name = chosen.length > 1 ? `${run.name} · ${target.brandName}` : run.name;
        const written = await writeReplay(plan, {
          name,
          briefLine: line,
          createdBy: userId(req),
        });
        results.push({ brandId, brandName: target.brandName, creativeId: written.creativeId, notes: plan.notes });
      }

      if (results.length === 0) {
        res.status(400).json({ error: "None of the brands chosen still exist." });
        return;
      }

      // Both columns together: the CHECK refuses a row that claims a run count
      // with no last-run time, and it is right to.
      await db
        .update(savedRunsTable)
        .set({ runCount: run.runCount + results.length, lastRunAt: new Date(), updatedAt: new Date() })
        .where(eq(savedRunsTable.id, id));

      await recordAudit({
        actor: actorFromRequest(req),
        action: "saved_run.ran",
        entityType: "saved_run",
        entityIds: [id],
        metadata: { creativeIds: results.map((r) => r.creativeId), brandIds: chosen },
      });

      res.status(201).json({ results });
    } catch (err) {
      console.error("Failed to run a saved run", err);
      res.status(500).json({ error: "The run could not be started." });
    }
  },
);

// ── rename and targets ───────────────────────────────────────────────────────

const RenameBody = z.object({ name: z.string().trim().min(1).max(120) });

router.patch(
  "/saved-runs/:id",
  requireStandardWrite,
  validateRequest({ body: RenameBody }),
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const [updated] = await db
      .update(savedRunsTable)
      .set({ name: (req.body as z.infer<typeof RenameBody>).name.trim(), updatedAt: new Date() })
      .where(eq(savedRunsTable.id, id))
      .returning({ id: savedRunsTable.id, name: savedRunsTable.name });
    if (!updated) {
      res.status(404).json({ error: "That saved run no longer exists." });
      return;
    }
    res.json(updated);
  },
);

const AddBrandBody = z.object({ brandId: z.string().min(1) });

router.post(
  "/saved-runs/:id/brands",
  requireStandardWrite,
  validateRequest({ body: AddBrandBody }),
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const { brandId } = req.body as z.infer<typeof AddBrandBody>;
    try {
      const [run] = await db.select({ id: savedRunsTable.id }).from(savedRunsTable).where(eq(savedRunsTable.id, id));
      if (!run) {
        res.status(404).json({ error: "That saved run no longer exists." });
        return;
      }
      // onConflictDoNothing rather than an existence check: adding a brand
      // twice is a double click, not an error worth showing anybody.
      await db.insert(savedRunBrandsTable).values({ savedRunId: id, brandId }).onConflictDoNothing();
      res.status(201).json({ ok: true, brands: await targetIdsFor(id) });
    } catch (err) {
      console.error("Failed to add a brand to a saved run", err);
      res.status(400).json({ error: "That brand could not be added." });
    }
  },
);

router.delete(
  "/saved-runs/:id/brands/:brandId",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const brandId = str(req.params.brandId);
    try {
      const current = await targetIdsFor(id);
      if (!current.includes(brandId)) {
        res.status(404).json({ error: "This run does not target that brand." });
        return;
      }
      /**
       * Refused here rather than letting the database sort it out. A trigger
       * removes a run whose last target went away, which is right for a brand
       * DELETE cascade (`0037`'s lesson: never make deleting a brand fail for
       * reasons nobody can read) but wrong as an answer to a user clicking the
       * last chip: they would lose the whole run and be told nothing.
       */
      if (current.length === 1) {
        res.status(400).json({
          error: "A run needs at least one brand. Add another brand first, or delete the run.",
        });
        return;
      }
      await db
        .delete(savedRunBrandsTable)
        .where(and(eq(savedRunBrandsTable.savedRunId, id), eq(savedRunBrandsTable.brandId, brandId)));
      res.json({ ok: true, brands: await targetIdsFor(id) });
    } catch (err) {
      console.error("Failed to remove a brand from a saved run", err);
      res.status(500).json({ error: "That brand could not be removed." });
    }
  },
);

router.delete("/saved-runs/:id", requireDestructive, async (req: Request, res: Response): Promise<void> => {
  const id = str(req.params.id);
  const [deleted] = await db.delete(savedRunsTable).where(eq(savedRunsTable.id, id)).returning({ id: savedRunsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "That saved run no longer exists." });
    return;
  }
  await recordAudit({
    actor: actorFromRequest(req),
    action: "saved_run.deleted",
    entityType: "saved_run",
    entityIds: [id],
  });
  res.json({ ok: true });
});

export default router;
