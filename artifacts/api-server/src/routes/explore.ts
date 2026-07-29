import { Router, type IRouter, type Request, type Response } from "express";
import { db, brandsTable, costLogsTable, creativesTable, designerPersonasTable, stageStatesTable, stageTakesTable, type DesignerPersona } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { AI_MODELS, COST_ESTIMATES, estimateImagenCost } from "../lib/ai-config.js";
import { isIntent, INTENT_LABELS, type Intent } from "../lib/intents.js";
import { generationLimiter } from "../lib/rate-limit.js";
import { reserveBudget, budgetExceededBody } from "../lib/budget.js";
import { requireStandardWrite } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate.js";
import { z } from "zod";
import { assembleContext } from "../services/context-assembly.js";
import { generateImage } from "../services/imagen.js";
import { buildGenerationPacket } from "../services/packet-assembly.js";
import {
  buildReferenceImages,
  loadPersonaReferenceImages,
  mergePersonaReferences,
  personaNoteFor,
  readFileByUrl,
} from "../services/reference-images.js";
import { writeBuffer } from "../services/storage.js";
import { buildSessionStyleContract, wrapEditInstruction } from "../services/creative-direction.js";
import { normalizeRegion, driftMessage, driftVerdict } from "../services/region-edit.js";
import { measureDrift, describeRegion } from "../services/region-drift.js";
import { runImageInteraction } from "../services/interactions-client.js";
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
/**
 * The director stage 02 chose, or the brand's locked default.
 *
 * Explore has to honour the choice made one stage earlier or stage 02 was
 * theatre. Falling back to the brand default matches what the spread itself
 * pre-selects, so the picture and the ranking agree about who is directing.
 */
async function directorFor(creativeId: string, brandId: string): Promise<DesignerPersona | null> {
  const [dirStage] = await db
    .select({ id: stageStatesTable.id })
    .from(stageStatesTable)
    .where(and(eq(stageStatesTable.creativeId, creativeId), eq(stageStatesTable.stageKind, "direction")));

  let personaId: string | null = null;
  if (dirStage) {
    const [take] = await db
      .select({ payload: stageTakesTable.payload })
      .from(stageTakesTable)
      .where(
        and(
          eq(stageTakesTable.stageStateId, dirStage.id),
          eq(stageTakesTable.slotKey, "direction"),
          eq(stageTakesTable.isCurrent, true),
        ),
      );
    const p = take?.payload as { directorId?: unknown; kind?: unknown } | undefined;
    // "house" is the absence of a director, not a persona id to look up.
    if (p?.kind !== "house" && typeof p?.directorId === "string") personaId = p.directorId;
  }
  if (!personaId) {
    const [brand] = await db
      .select({ defaultPersonaId: brandsTable.defaultPersonaId })
      .from(brandsTable)
      .where(eq(brandsTable.id, brandId));
    personaId = brand?.defaultPersonaId ?? null;
  }
  if (!personaId) return null;

  const [persona] = await db
    .select()
    .from(designerPersonasTable)
    .where(eq(designerPersonasTable.id, personaId));
  return persona ?? null;
}

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

      /*
       * Reference imagery. Assembled ONCE for the whole spread, not per take:
       * every take shares the same brand assets and the same director's work
       * samples, so loading them eight times would be eight times the I/O for
       * identical buffers. What varies per take is the axis directive, which is
       * text.
       *
       * This closes a real gap. Until now Explore sent the brand's prose steering
       * and no imagery at all, so the asset library was known about and never
       * used. Failing to load references must not fail the spread, so this
       * degrades to prose-only rather than throwing.
       */
      const persona = await directorFor(creativeId, creative.brandId);
      let referenceImages: Awaited<ReturnType<typeof buildReferenceImages>> = [];
      let referenceNote: string | null = null;
      try {
        const personaRefs = await loadPersonaReferenceImages(persona);
        const packet = await buildGenerationPacket({
          creativeId,
          brandId: creative.brandId,
          templateId: creative.templateId,
          platform: "instagram_feed",
          selectedAssetIds: [],
          briefText: ctx.combinedBrief,
          // The spread is exploring composition, so neither subjects nor styles
          // should dominate the slots before the axes have had their say.
          balance: "balanced",
          dryRun: true,
        });
        referenceImages = mergePersonaReferences(await buildReferenceImages(packet), personaRefs);
        referenceNote = personaNoteFor(persona, personaRefs);
      } catch (err) {
        console.error("Explore could not assemble references, falling back to prose steering", err);
      }

      const results = await mapWithConcurrency(plan.takes, RUN_CONCURRENCY, async (take) => {
        const takeCtx = {
          ...ctx,
          combinedBrief: briefForTake(ctx.combinedBrief, take.directive),
          designerPersona: persona ?? ctx.designerPersona,
        };
        const image = await generateImage(takeCtx, "instagram_feed", referenceImages);
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
                // Recorded on the take, not just returned, so the Material rail
                // can state what this image was actually made from long after the
                // run response is gone (§1.17).
                material: {
                  referenceCount: referenceImages.length,
                  director: persona?.name ?? null,
                },
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
        // §1.17: what actually reached the model, reported rather than implied.
        material: {
          referenceCount: referenceImages.length,
          subjectCount: referenceImages.filter(r => r.role === "subject_reference").length,
          styleCount: referenceImages.filter(r => r.role === "style_reference").length,
          director: persona?.name ?? null,
          personaNote: referenceNote,
        },
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

/**
 * Switch stage 03 between Explore and Refine, recording which take was chosen.
 *
 * §1.2: this is one stage in two modes, not two screens, which is why the mode
 * lives on the stage row rather than becoming a sixth stage.
 *
 * The choice is written as a take in the "selected" slot rather than a column.
 * A take is this system's record of a decision, so recording it that way gets
 * the history for free: you can see what was picked before, and picking again
 * supersedes rather than overwrites.
 */
const ModeBody = z.object({
  mode: z.enum(["explore", "refine"]),
  /** Required when entering refine: which Explore slot is being refined. */
  slotKey: z.string().min(1).max(64).optional(),
});

router.post(
  "/creatives/:creativeId/stages/:stageId/image-mode",
  requireStandardWrite,
  validateRequest({ body: ModeBody }),
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const stageId = String(req.params.stageId);
    const { mode, slotKey } = req.body as z.infer<typeof ModeBody>;

    if (mode === "refine" && !slotKey) {
      res.status(400).json({ error: "Refine needs to know which take you are refining." });
      return;
    }

    try {
      const [stage] = await db
        .select({ id: stageStatesTable.id, status: stageStatesTable.status })
        .from(stageStatesTable)
        .where(and(eq(stageStatesTable.id, stageId), eq(stageStatesTable.creativeId, creativeId)));
      if (!stage) {
        res.status(404).json({ error: "Stage not found on this creative" });
        return;
      }
      if (stage.status === "locked") {
        res.status(409).json({ error: "This stage is locked, so it was not changed. Unlock it first." });
        return;
      }

      await db.transaction(async (tx) => {
        await tx
          .update(stageStatesTable)
          .set({ mode, updatedAt: new Date() })
          .where(eq(stageStatesTable.id, stageId));

        if (mode === "refine" && slotKey) {
          await tx
            .update(stageTakesTable)
            .set({ isCurrent: false })
            .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.slotKey, "selected")));
          const prior = await tx
            .select({ takeIndex: stageTakesTable.takeIndex })
            .from(stageTakesTable)
            .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.slotKey, "selected")));
          await tx.insert(stageTakesTable).values({
            stageStateId: stageId,
            slotKey: "selected",
            takeIndex: prior.length,
            origin: "swapped_in",
            payload: { slotKey },
            isCurrent: true,
          });
        }
      });

      res.json({ mode, slotKey: slotKey ?? null });
    } catch (err) {
      console.error("Failed to switch image mode", err);
      res.status(500).json({ error: "That could not be saved." });
    }
  },
);

/**
 * Make an earlier take current again.
 *
 * Restoring is not undoing: the later takes stay on the record, because the
 * history is the point of the deck. What changes is which one downstream stages
 * read (§1.3, dependency is what a stage actually consumed).
 */
router.post(
  "/creatives/:creativeId/stages/:stageId/takes/:takeId/current",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const stageId = String(req.params.stageId);
    const takeId = String(req.params.takeId);

    try {
      const [stage] = await db
        .select({ id: stageStatesTable.id, status: stageStatesTable.status })
        .from(stageStatesTable)
        .where(and(eq(stageStatesTable.id, stageId), eq(stageStatesTable.creativeId, creativeId)));
      if (!stage) {
        res.status(404).json({ error: "Stage not found on this creative" });
        return;
      }
      if (stage.status === "locked") {
        res.status(409).json({ error: "This stage is locked, so it was not changed. Unlock it first." });
        return;
      }

      const [take] = await db
        .select({ id: stageTakesTable.id, slotKey: stageTakesTable.slotKey })
        .from(stageTakesTable)
        .where(and(eq(stageTakesTable.id, takeId), eq(stageTakesTable.stageStateId, stageId)));
      if (!take) {
        res.status(404).json({ error: "That take is not on this stage." });
        return;
      }

      await db.transaction(async (tx) => {
        // Clear first: the partial unique index allows one current take per slot.
        await tx
          .update(stageTakesTable)
          .set({ isCurrent: false })
          .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.slotKey, take.slotKey)));
        await tx.update(stageTakesTable).set({ isCurrent: true }).where(eq(stageTakesTable.id, takeId));
      });

      res.json({ takeId, slotKey: take.slotKey });
    } catch (err) {
      console.error("Failed to restore take", err);
      res.status(500).json({ error: "That take could not be restored." });
    }
  },
);

/**
 * Edit one region of one take.
 *
 * Spec: plan item 4, `21_SPEC_01_DATA_MODEL.md` §4.4, and §1.13 / §1.17.
 *
 * Three things make this different from a re-roll.
 *
 * The brand contract wraps every edit via the existing wrapEditInstruction, so a
 * region edit cannot quietly walk the image off brand. The instruction still wins
 * on conflict, because §1.13 says the contract binds the model and advises the
 * human, and only the human knows when a rule should bend.
 *
 * The model has no mask input: the Interactions API does semantic masking, so the
 * geometry becomes words. That is a real limitation and it is exactly why the next
 * point matters.
 *
 * Drift is MEASURED, not assumed. Because the mask is prose, the model can ignore
 * it, so afterwards we compare before and after outside the region and report how
 * much moved. §1.17: the invisible made visible. The result is kept either way and
 * the verdict advises, per §1.13.
 */
const RegionEditBody = z.object({
  slotKey: z.string().min(1).max(64),
  region: z.unknown(),
  instruction: z.string().min(1).max(1000),
});

router.post(
  "/creatives/:creativeId/stages/:stageId/region-edit",
  requireStandardWrite,
  generationLimiter,
  validateRequest({ body: RegionEditBody }),
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const stageId = String(req.params.stageId);
    const { slotKey, region: rawRegion, instruction } = req.body as z.infer<typeof RegionEditBody>;
    let reservationId: string | null = null;

    try {
      // Reject a bad region BEFORE reserving anything. A silently widened mask
      // would edit pixels nobody selected, and the drift report cannot undo that.
      const region = normalizeRegion(rawRegion);
      if (!region) {
        res.status(400).json({
          error: "That selection could not be read as an area, so nothing was changed or charged.",
        });
        return;
      }

      const [creative] = await db.select().from(creativesTable).where(eq(creativesTable.id, creativeId));
      if (!creative) {
        res.status(404).json({ error: "Creative not found" });
        return;
      }

      const [stage] = await db
        .select({ id: stageStatesTable.id, status: stageStatesTable.status })
        .from(stageStatesTable)
        .where(and(eq(stageStatesTable.id, stageId), eq(stageStatesTable.creativeId, creativeId)));
      if (!stage) {
        res.status(404).json({ error: "Stage not found on this creative" });
        return;
      }
      if (stage.status === "locked") {
        res.status(409).json({
          error: "This stage is locked, so nothing was changed and nothing was charged. Unlock it first.",
          stageStatus: "locked",
        });
        return;
      }

      const [current] = await db
        .select({ payload: stageTakesTable.payload, takeIndex: stageTakesTable.takeIndex })
        .from(stageTakesTable)
        .where(
          and(
            eq(stageTakesTable.stageStateId, stageId),
            eq(stageTakesTable.slotKey, slotKey),
            eq(stageTakesTable.isCurrent, true),
          ),
        );
      const beforeUrl = (current?.payload as { imageUrl?: unknown } | undefined)?.imageUrl;
      if (typeof beforeUrl !== "string") {
        res.status(400).json({ error: "That take has no image to edit, so nothing was charged." });
        return;
      }
      const beforeBuffer = await readFileByUrl(beforeUrl);
      if (!beforeBuffer) {
        res.status(400).json({ error: "The image for that take could not be read, so nothing was charged." });
        return;
      }

      const budget = await reserveBudget(creativeId, estimateImagenCost(1));
      if (!budget.ok) {
        res.status(429).json(budgetExceededBody(budget.todaySpend, budget.threshold));
        return;
      }
      reservationId = budget.reservationId;

      const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, creative.brandId));
      const persona = await directorFor(creativeId, creative.brandId);
      const contract = brand ? buildSessionStyleContract({ brand, persona }) : "";

      const scoped = `Change only ${describeRegion(region)}. ${instruction.trim()} Leave the rest of the image exactly as it is.`;
      const prompt = wrapEditInstruction(contract, scoped);

      const result = await runImageInteraction({
        prompt,
        slots: [{ imageBuffer: beforeBuffer, mimeType: "image/png", slot: "object", description: "The image being edited." }],
      });

      const filename = takeFilename(creativeId, `${slotKey}_edit`, crypto.randomUUID().slice(0, 8));
      await writeBuffer("generated", filename, result.imageBuffer);
      const afterUrl = `/api/files/generated/${filename}`;

      // Measured after storing, so a drift-measurement failure cannot lose an
      // image the user has already paid for.
      let drift: { driftPercent: number; sampledOutside: number; changedOutside: number } | null = null;
      try {
        drift = await measureDrift(beforeBuffer, result.imageBuffer, region);
      } catch (err) {
        console.error("Drift could not be measured for a region edit", err);
      }

      await db.transaction(async (tx) => {
        await tx
          .update(stageTakesTable)
          .set({ isCurrent: false })
          .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.slotKey, slotKey)));
        const prior = await tx
          .select({ takeIndex: stageTakesTable.takeIndex })
          .from(stageTakesTable)
          .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.slotKey, slotKey)));
        await tx.insert(stageTakesTable).values({
          stageStateId: stageId,
          slotKey,
          takeIndex: prior.length,
          origin: "region_edit",
          payload: {
            imageUrl: afterUrl,
            sourceImageUrl: beforeUrl,
            instruction: instruction.trim(),
            region,
            drift,
            material: { referenceCount: 1, director: persona?.name ?? null },
          },
          isCurrent: true,
          costCents: Math.round(estimateImagenCost(1) * 100),
        });

        if (reservationId) await tx.delete(costLogsTable).where(eq(costLogsTable.id, reservationId));
        await tx.insert(costLogsTable).values({
          creativeId,
          service: "gemini",
          operation: "region_edit",
          model: AI_MODELS.GEMINI_FLASH_IMAGE,
          costUsd: estimateImagenCost(1),
        });
      });
      reservationId = null;

      res.json({
        imageUrl: afterUrl,
        drift: drift
          ? {
              ...drift,
              verdict: driftVerdict(drift.driftPercent),
              message: driftMessage(drift.driftPercent),
            }
          : null,
        // Said plainly rather than left as a silent null, per §1.14.
        driftUnavailable: drift === null
          ? "The edit worked, but how far it strayed outside your selection could not be measured."
          : null,
      });
    } catch (err) {
      if (reservationId) {
        try { await db.delete(costLogsTable).where(eq(costLogsTable.id, reservationId)); } catch { /* best effort */ }
      }
      console.error("Region edit failed", err);
      res.status(500).json({ error: "That edit could not be made. Nothing was charged." });
    }
  },
);

export default router;
