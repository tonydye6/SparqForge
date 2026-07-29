import { Router, type IRouter, type Request, type Response } from "express";
import { db, costLogsTable, creativesTable, stageStatesTable, stageTakesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { AI_MODELS, COST_ESTIMATES } from "../lib/ai-config.js";
import { isIntent, INTENT_LABELS, type Intent } from "../lib/intents.js";
import { generationLimiter } from "../lib/rate-limit.js";
import { reserveBudget, budgetExceededBody } from "../lib/budget.js";
import { requireStandardWrite } from "../middleware/auth.js";
import { assembleContext } from "../services/context-assembly.js";
import { generateImage } from "../services/imagen.js";
import { writeBuffer } from "../services/storage.js";
import { buildExplorePlan } from "../services/explore-plan.js";
import {
  RUN_CONCURRENCY,
  briefForTake,
  mapWithConcurrency,
  reservationUsd,
  settledCostUsd,
  takeErrorMessage,
  takeFilename,
  type TakeOutcome,
} from "../services/explore-run.js";

/**
 * Stage 03 · Image · the Explore plan endpoint.
 *
 * Plans the spread. Generates nothing. Eight images is real money, so the user
 * is shown the structure and the price and then decides (§1.5: downstream runs
 * are offered with their price, never automatic).
 *
 * The goal is READ off the brief take rather than inferred again. Stage 01
 * already paid for that classification and recorded it, so re-inferring here
 * would cost twice and, worse, could have the two stages disagree about what the
 * post is for.
 *
 * Axes are the deterministic per-goal pair for now. The model-proposed path is
 * built and validated in explore-plan.ts but is deliberately not switched on
 * here: it would put a model call behind a screen nobody has reviewed yet, and
 * the standard pairs are honest and free. Switch it on in the generation
 * increment, once Tony has seen the screen.
 */

const router: IRouter = Router();

/** The goal recorded by stage 01, if there is one. */
async function intentFromBrief(creativeId: string): Promise<{ intent: Intent | null; briefStageId: string | null }> {
  const [brief] = await db
    .select({ id: stageStatesTable.id })
    .from(stageStatesTable)
    .where(and(eq(stageStatesTable.creativeId, creativeId), eq(stageStatesTable.stageKind, "brief")));
  if (!brief) return { intent: null, briefStageId: null };

  const [take] = await db
    .select({ payload: stageTakesTable.payload })
    .from(stageTakesTable)
    .where(
      and(
        eq(stageTakesTable.stageStateId, brief.id),
        eq(stageTakesTable.slotKey, "brief"),
        eq(stageTakesTable.isCurrent, true),
      ),
    );

  const payload = take?.payload as { intentId?: unknown } | null | undefined;
  const raw = payload && typeof payload === "object" ? payload.intentId : null;
  return { intent: isIntent(raw) ? raw : null, briefStageId: brief.id };
}

router.get("/creatives/:creativeId/explore-plan", async (req: Request, res: Response): Promise<void> => {
  const creativeId = String(req.params.creativeId);

  try {
    const { intent, briefStageId } = await intentFromBrief(creativeId);

    // No brief yet, or a brief saved before the goal was recorded. Planning
    // against a default is better than refusing to show the screen, but the
    // response says so rather than implying the axes were chosen for this post.
    const effective: Intent = intent ?? "awareness";

    const plan = buildExplorePlan({
      intent: effective,
      perImageUsd: COST_ESTIMATES.IMAGEN_PER_IMAGE_USD,
    });

    res.json({
      ...plan,
      goal: { id: effective, label: INTENT_LABELS[effective], fromBrief: intent !== null },
      briefStageId,
      // Nothing has been generated. Said explicitly so a client cannot mistake a
      // plan for a result.
      generated: false,
    });
  } catch (err) {
    console.error("Failed to build the explore plan", err);
    res.status(500).json({ error: "The spread could not be planned." });
  }
});

/**
 * Run the spread. This is the first thing in the Studio that spends real money,
 * so the order of operations matters more than the code volume.
 *
 *   reserve worst case -> generate -> store -> record takes -> settle real spend
 *
 * The reservation is the whole spread, taken before a single call goes out, so a
 * concurrent run cannot jointly blow the daily threshold (the reservation holds
 * the advisory lock). It is settled against successes only: charging for the
 * whole spread when three takes failed would bill for pictures nobody received,
 * and the failure count travels with the response so the gap is visible rather
 * than quietly absorbed.
 *
 * A failed take never costs the others. §1.5 means the user consented to this
 * spend; losing seven good takes to one bad upstream call would be the worst
 * possible way to spend it.
 */
router.post(
  "/creatives/:creativeId/explore-run",
  requireStandardWrite,
  generationLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const perImageUsd = COST_ESTIMATES.IMAGEN_PER_IMAGE_USD;
    let reservationId: string | null = null;

    try {
      const [creative] = await db.select().from(creativesTable).where(eq(creativesTable.id, creativeId));
      if (!creative) {
        res.status(404).json({ error: "Creative not found" });
        return;
      }

      const [stage] = await db
        .select({ id: stageStatesTable.id, status: stageStatesTable.status })
        .from(stageStatesTable)
        .where(and(eq(stageStatesTable.creativeId, creativeId), eq(stageStatesTable.stageKind, "asset")));
      if (!stage) {
        res.status(404).json({ error: "This creative has no Image stage." });
        return;
      }
      // Same rule as the takes endpoint, checked before spending rather than
      // after: a locked stage refuses writes (§1.4).
      if (stage.status === "locked") {
        res.status(409).json({
          error: "The Image stage is locked, so nothing was generated and nothing was charged. Unlock it first.",
          stageStatus: "locked",
        });
        return;
      }

      // A creative can lose its template (the FK is ON DELETE SET NULL), and the
      // prompt assembler needs one. Refusing here costs nothing; discovering it
      // after reserving budget would leave a reservation to clean up.
      if (!creative.templateId) {
        res.status(400).json({
          error: "This creative has no template, so the spread cannot be composed. Nothing was charged.",
        });
        return;
      }

      const { intent } = await intentFromBrief(creativeId);
      const plan = buildExplorePlan({ intent: intent ?? "awareness", perImageUsd });

      const budget = await reserveBudget(creativeId, reservationUsd(plan.takes.length, perImageUsd));
      if (!budget.ok) {
        res.status(429).json(budgetExceededBody(budget.todaySpend, budget.threshold));
        return;
      }
      reservationId = budget.reservationId;

      const ctx = await assembleContext({
        brandId: creative.brandId,
        templateId: creative.templateId,
        selectedAssets: [],
        intent: intent ?? null,
      });

      const results = await mapWithConcurrency(plan.takes, RUN_CONCURRENCY, async (take) => {
        const takeCtx = { ...ctx, combinedBrief: briefForTake(ctx.combinedBrief, take.directive) };
        const image = await generateImage(takeCtx, "instagram_feed");
        const filename = takeFilename(creativeId, take.id, crypto.randomUUID().slice(0, 8));
        await writeBuffer("generated", filename, image.imageBuffer);
        return `/api/files/generated/${filename}`;
      });

      const outcomes: TakeOutcome[] = plan.takes.map((take, i) => {
        const r = results[i];
        return r?.ok
          ? { takeId: take.id, ok: true, imageUrl: r.value }
          : { takeId: take.id, ok: false, error: takeErrorMessage(r?.error) };
      });

      // Record every take that produced an image. A slot per take id, so a
      // re-run of one take supersedes only itself.
      const succeeded = outcomes.filter(o => o.ok);
      if (succeeded.length > 0) {
        await db.transaction(async (tx) => {
          for (const o of succeeded) {
            const take = plan.takes.find(t => t.id === o.takeId)!;
            await tx
              .update(stageTakesTable)
              .set({ isCurrent: false })
              .where(and(eq(stageTakesTable.stageStateId, stage.id), eq(stageTakesTable.slotKey, o.takeId)));
            const existing = await tx
              .select({ takeIndex: stageTakesTable.takeIndex })
              .from(stageTakesTable)
              .where(and(eq(stageTakesTable.stageStateId, stage.id), eq(stageTakesTable.slotKey, o.takeId)));
            await tx.insert(stageTakesTable).values({
              stageStateId: stage.id,
              slotKey: o.takeId,
              takeIndex: existing.length,
              origin: "generated",
              payload: {
                imageUrl: o.imageUrl,
                axisA: take.axisA,
                axisB: take.axisB,
                directive: take.directive,
                offBrief: take.offBrief,
              },
              isCurrent: true,
              costCents: Math.round(perImageUsd * 100),
            });
          }
        });
      }

      // Settle: drop the reservation and record what actually landed.
      const settled = settledCostUsd(outcomes, perImageUsd);
      await db.transaction(async (tx) => {
        if (reservationId) await tx.delete(costLogsTable).where(eq(costLogsTable.id, reservationId));
        if (settled > 0) {
          await tx.insert(costLogsTable).values({
            creativeId,
            service: "gemini",
            operation: "explore_spread",
            model: AI_MODELS.GEMINI_FLASH_IMAGE,
            costUsd: settled,
          });
        }
      });
      reservationId = null;

      res.json({
        outcomes,
        succeeded: succeeded.length,
        failed: outcomes.length - succeeded.length,
        costUsd: settled,
        generated: true,
      });
    } catch (err) {
      // Never leave a reservation behind: a phantom row would eat the daily
      // budget for work that never happened.
      if (reservationId) {
        try { await db.delete(costLogsTable).where(eq(costLogsTable.id, reservationId)); } catch { /* best effort */ }
      }
      console.error("Explore run failed", err);
      res.status(500).json({ error: "The spread could not be run. Nothing was charged." });
    }
  },
);

export default router;
