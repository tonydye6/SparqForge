import { Router, type IRouter, type Request, type Response } from "express";
import { db, assetsTable, brandsTable, costLogsTable, creativesTable, designerPersonasTable, stageStatesTable, stageTakesTable, type DesignerPersona } from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { AI_MODELS, COST_ESTIMATES, estimateImagenCost } from "../lib/ai-config.js";
import { isIntent, INTENT_LABELS, type Intent } from "../lib/intents.js";
import { generationLimiter } from "../lib/rate-limit.js";
import { reserveBudget, budgetExceededBody } from "../lib/budget.js";
import { requireStandardWrite } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate.js";
import { z } from "zod";
import { resolveStyleProfile } from "../services/context-assembly.js";
import { generateImageFromPrompt, type ReferenceImage } from "../services/imagen.js";
import { MAX_IMAGE_REFERENCES } from "../services/packet-assembly.js";
import {
  loadPersonaReferenceImages,
  personaNoteFor,
  readFileByUrl,
} from "../services/reference-images.js";
import { writeBuffer } from "../services/storage.js";
import {
  buildAssetCatalog,
  buildCreativeDirection,
  buildOverflowDescriptors,
  buildSessionStyleContract,
  loadBrand,
  mergeReferenceSlots,
  wrapEditInstruction,
} from "../services/creative-direction.js";
import {
  buildDirectedPrompt,
  loadAssetIdReferences,
  loadDirectedReferences,
  orderReferences,
  type DirectedPromptInput,
} from "../services/explore-direction.js";
import { normalizeRegion, driftMessage, driftVerdict } from "../services/region-edit.js";
import { measureDrift, describeRegion } from "../services/region-drift.js";
import { runImageInteraction } from "../services/interactions-client.js";
import { buildExplorePlan } from "../services/explore-plan.js";
import { nextTakeIndex } from "../services/stage-graph.js";
import {
  RUN_CONCURRENCY,
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
async function intentFromBrief(creativeId: string): Promise<{ intent: Intent | null; briefStageId: string | null; briefText: string | null }> {
  const [brief] = await db
    .select({ id: stageStatesTable.id })
    .from(stageStatesTable)
    .where(and(eq(stageStatesTable.creativeId, creativeId), eq(stageStatesTable.stageKind, "brief")));
  if (!brief) return { intent: null, briefStageId: null, briefText: null };

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

  const payload = take?.payload as { intentId?: unknown; line?: unknown; derived?: unknown } | null | undefined;
  const raw = payload && typeof payload === "object" ? payload.intentId : null;
  /*
   * The typed line, and the derived rows the user saw and could edit. This is
   * what the person actually said, and it was once read for its intentId and then
   * thrown away, so the model composed from the creative's OLD stored brief and
   * "female tennis player" never reached it at all.
   *
   * It now feeds two things that both depend on it being the REAL brief: the
   * Creative Director's direction, and the ranking of the asset catalog it
   * chooses from. A live probe measured the difference: with the brief passed
   * through, the Crown U tennis character scores 20.35 and ranks first among
   * scored assets, where the old wrong text matched nothing at all.
   */
  let briefText: string | null = null;
  if (payload && typeof payload === "object" && typeof payload.line === "string" && payload.line.trim()) {
    const parts = [payload.line.trim()];
    if (Array.isArray(payload.derived)) {
      for (const d of payload.derived) {
        const row = d as { label?: unknown; value?: unknown };
        if (typeof row?.label === "string" && typeof row?.value === "string") {
          parts.push(`${row.label}: ${row.value}`);
        }
      }
    }
    briefText = parts.join("\n");
  }
  return { intent: isIntent(raw) ? raw : null, briefStageId: brief.id, briefText };
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

/**
 * Load specific assets by id, brand-scoped.
 *
 * Brand-scoped in the QUERY rather than checked afterwards, so an id from a
 * stale deep link or another brand's style profile cannot pull a foreign asset
 * into a Crown U post. Screen 6's containment rule is a scoping rule first.
 */
async function loadBrandAssetsByIds(brandId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(assetsTable)
    .where(
      and(
        eq(assetsTable.brandId, brandId),
        ne(assetsTable.status, "archived"),
        inArray(assetsTable.id, ids),
      ),
    );
  // Preserve the caller's order: a style profile's reference list is ordered by
  // a human, and re-ordering it by whatever the planner returned would quietly
  // change which reference survives the slot cap.
  const byId = new Map(rows.map(r => [r.id, r]));
  return ids.map(id => byId.get(id)).filter((a): a is NonNullable<typeof a> => Boolean(a));
}

router.post(
  "/creatives/:creativeId/explore-run",
  requireStandardWrite,
  generationLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const perImageUsd = COST_ESTIMATES.IMAGEN_PER_IMAGE_USD;
    let reservationId: string | null = null;
    // Declared out here because the error handler needs it: it decides whether
    // "nothing was charged" is a true statement or a lie (§1.14).
    let generationStarted = false;

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

      const { intent, briefStageId, briefText } = await intentFromBrief(creativeId);
      const plan = buildExplorePlan({ intent: intent ?? "awareness", perImageUsd });

      const budget = await reserveBudget(creativeId, reservationUsd(plan.takes.length, perImageUsd));
      if (!budget.ok) {
        res.status(429).json(budgetExceededBody(budget.todaySpend, budget.threshold));
        return;
      }
      reservationId = budget.reservationId;

      /*
       * THE CREATIVE DIRECTOR, which this path used to skip entirely.
       *
       * What was here before was a copy of the LEGACY stack: assembleContext ->
       * matchAssetsToBrief -> brandSubjectFloor -> buildGenerationPacket ->
       * buildReferenceImages -> buildImagePrompt. That made v2 the THIRD
       * generation stack in this repo and reintroduced the exact failure v2 was
       * created to fix, because `buildCreativeDirection` was written in July
       * specifically to stop the model ignoring the asset library and nothing on
       * this path ever called it (25_GENERATION_ARCHITECTURE §1).
       *
       * The difference is not prompt strength, it is WHO CHOOSES. The token
       * scanner scored asset text against brief text and, on a brief that did not
       * happen to name a character, matched zero of the brand's assets; the floor
       * that patched that ranked on `subjectIdentityScore`, which a live probe
       * confirmed is 0 on every eligible subject reference, so it was sorting a
       * dead field. The Director instead reads a policy-filtered catalog of the
       * real library, with each asset's entities, tags, colors and identity note,
       * and returns the ids it chose with a role for each. Ineligible assets never
       * receive a catalog id, so it cannot pick one.
       *
       * ONE Director call for the whole spread, not one per take. Eight calls
       * would be eight different subjects, which is the opposite of a spread:
       * one direction, eight variations of it. References are likewise loaded
       * once, because all eight takes share them and only the axis directive
       * varies.
       *
       * Failing to assemble must not fail a spread the user consented to pay for,
       * so this degrades: no director, no references, prose only.
       */
      const persona = await directorFor(creativeId, creative.brandId);
      let references: ReferenceImage[] = [];
      let referenceNote: string | null = null;
      /*
       * The prompt INPUTS, not a finished prompt string.
       *
       * The axis directive is not appendable: buildDirectedPrompt places it
       * between the reference roll-call and the brand constraints, deliberately,
       * so that a per-take directive can never read as though it outranks the
       * brand contract. So the shared parts are assembled once and each take
       * calls the assembler with its own directive.
       */
      let promptInputs: DirectedPromptInput | null = null;
      let directorSelections: Array<{ assetId: string; role: string }> = [];
      let directorFallback = false;
      let catalogSize = 0;
      let hasMarkReference = false;
      let styleContract = "";
      let directorAspectRatio: string | null = null;

      /*
       * The direction step is DELIBERATELY NOT wrapped in a catch.
       *
       * An earlier draft of this degraded to "brand rules plus the brief" when the
       * Director was unreachable, and that was wrong about money: the user
       * consented to $0.48 for a DIRECTED spread, so quietly spending it on eight
       * undirected images buys them something they did not ask for. Letting it
       * throw reaches the outer handler, which releases the reservation before a
       * single image is generated, so the honest outcome is no spread and no
       * charge rather than a weak spread and a full charge.
       *
       * buildCreativeDirection already absorbs the failures worth absorbing: it
       * retries once at temperature 0 and falls back to prose-only when the JSON
       * will not parse. Reaching here means a genuine outage, not a bad roll.
       */
      const brand = await loadBrand(creative.brandId);
      const styleProfile = await resolveStyleProfile(creative.brandId, creative.styleProfileId);
      styleContract = buildSessionStyleContract({ brand, styleProfile, persona });

      // The brief the person actually typed, plus the derived rows they saw and
      // could edit. This is what the Director reads and what the catalog is
      // ranked against.
      const effectiveBrief = briefText ?? creative.briefText ?? "";

      const catalog = await buildAssetCatalog({
        brandId: creative.brandId,
        briefText: effectiveBrief,
        template: creative.templateId ?? null,
      });
      catalogSize = catalog.lines.length;

      const direction = await buildCreativeDirection({
        brand,
        styleContract,
        briefText: effectiveBrief,
        intent: intent ?? null,
        catalog,
      });
      directorSelections = direction.assetSelections;
      directorFallback = direction.usedFallback;
      directorAspectRatio = direction.aspectRatio;

      /*
       * Reference LOADING, by contrast, does degrade.
       *
       * A storage read that fails costs the spread some imagery, not its
       * direction, and the direction is the part that was paid for. Zero
       * references is reported rather than hidden, and the rail states it in the
       * warning hue.
       */
      try {
        const directed = await loadDirectedReferences(direction.assetSelections, catalog.byId);
        hasMarkReference = directed.hasMark;

        /*
         * Explicit human choices still outrank the model's.
         *
         * A style profile's reference images and any assets a deep link put on the
         * creative were chosen by a person, so they enter above the Director in
         * the same priority order the Co-pilot uses. Loaded directly by id rather
         * than through buildGenerationPacket, which is what let the borrowed
         * template requirement, and its "no active templates" dead end, be
         * deleted outright: Explore composites nothing and never needed a layout.
         */
        const creativeSelected = ((creative.selectedAssets || []) as Array<{ assetId?: string }>)
          .map(a => a.assetId)
          .filter((id): id is string => typeof id === "string");
        const attachedRefs = await loadAssetIdReferences(
          await loadBrandAssetsByIds(creative.brandId, creativeSelected),
          "subject_reference",
        );
        const styleProfileRefs = await loadAssetIdReferences(
          await loadBrandAssetsByIds(creative.brandId, styleProfile?.referenceAssetIds ?? []),
          "style_reference",
        );

        const personaRefs = await loadPersonaReferenceImages(persona);
        referenceNote = personaNoteFor(persona, personaRefs);

        // The same budgeting the Co-pilot uses, now generic over the reference
        // shape: attachments > director > packet > guaranteed persona slots.
        const merged = mergeReferenceSlots<ReferenceImage>({
          attached: attachedRefs,
          director: directed.references,
          packet: styleProfileRefs,
          persona: personaRefs,
          cap: MAX_IMAGE_REFERENCES,
        });
        references = orderReferences(merged);

        // Selections that lost their slot still steer as prose rather than
        // vanishing, which is the batch path's behaviour and the Co-pilot's.
        const usedIds = new Set(references.map(r => r.assetId).filter(Boolean));
        const overflow = direction.assetSelections
          .filter(sel => !usedIds.has(sel.assetId))
          .map(sel => catalog.byId.get(sel.assetId))
          .filter((a): a is NonNullable<typeof a> => Boolean(a));

        promptInputs = {
          directorPrompt: direction.prompt,
          styleContract,
          overflowBlock: buildOverflowDescriptors(overflow),
          references,
          hasMarkReference,
        };
      } catch (err) {
        console.error("Explore could not load reference imagery; the direction still stands", err);
      }

      // The direction exists either way by this point; only its imagery is
      // optional, so this keeps the director's prose rather than inventing prose.
      const effectivePromptInputs: DirectedPromptInput = promptInputs ?? {
        directorPrompt: direction.prompt,
        styleContract,
        references: [],
        hasMarkReference: false,
      };

      generationStarted = true;
      const results = await mapWithConcurrency(plan.takes, RUN_CONCURRENCY, async (take) => {
        const image = await generateImageFromPrompt(
          buildDirectedPrompt({ ...effectivePromptInputs, axisDirective: take.directive }),
          "instagram_feed",
          references,
        );
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

      /*
       * Settle the real spend BEFORE recording the takes.
       *
       * The order is the whole point. These images have already been generated and
       * already been billed upstream, so the cost is a fact the moment the calls
       * returned. Settling afterwards meant that a failure while recording takes
       * rolled back the settlement too, and the money vanished from cost_logs while
       * still having left the account. Recording spend first cannot lose it.
       */
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

      // Record every take that produced an image. A slot per take id, so a
      // re-run of one take supersedes only itself.
      const succeeded = outcomes.filter(o => o.ok);
      if (succeeded.length > 0) {
        /*
         * What this run actually consumed. Recorded, never inferred (§1.3).
         *
         * This was missing entirely: explore-run inserted takes directly and never
         * touched stage_states.consumedFrom, so the Image stage claimed to have
         * consumed nothing. The visible symptom was the "Why this" strip saying
         * "nothing upstream can invalidate it", and the invisible one was far worse:
         * rewriting the brief would NOT have marked Image stale, because staleness
         * is a walk over consumedFrom. The spine's central promise was quietly not
         * being kept for the one stage that costs money to redo.
         *
         * The brief is in here because the goal came from it and chose the axes.
         * Direction is in here when a director was applied.
         */
        const [dirStage] = await db
          .select({ id: stageStatesTable.id })
          .from(stageStatesTable)
          .where(and(eq(stageStatesTable.creativeId, creativeId), eq(stageStatesTable.stageKind, "direction")));
        const consumed = [briefStageId, persona ? dirStage?.id : null].filter(
          (id): id is string => typeof id === "string",
        );

        await db.transaction(async (tx) => {
          for (const o of succeeded) {
            const take = plan.takes.find(t => t.id === o.takeId)!;
            await tx
              .update(stageTakesTable)
              .set({ isCurrent: false })
              .where(and(eq(stageTakesTable.stageStateId, stage.id), eq(stageTakesTable.slotKey, o.takeId)));
            // stage_takes has a CHECK (take_index >= 1), and nextTakeIndex is the
            // one place that already owns the 1-based convention. Using a 0-based
            // array length here violated the constraint on the very first take of
            // every slot, which rolled back the whole spread.
            const existing = await tx
              .select({ slotKey: stageTakesTable.slotKey, takeIndex: stageTakesTable.takeIndex })
              .from(stageTakesTable)
              .where(and(eq(stageTakesTable.stageStateId, stage.id), eq(stageTakesTable.slotKey, o.takeId)));
            await tx.insert(stageTakesTable).values({
              stageStateId: stage.id,
              slotKey: o.takeId,
              takeIndex: nextTakeIndex(existing, o.takeId),
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
                  referenceCount: references.length,
                  subjectCount: references.filter(r => r.role === "subject_reference").length,
                  styleCount: references.filter(r => r.role === "style_reference").length,
                  director: persona?.name ?? null,
                  /*
                   * The Creative Director's actual decision, recorded per take.
                   *
                   * `matchedCount` and `usedSubjectFloor` used to live here and are
                   * gone with the machinery that produced them: a match count off a
                   * token scanner and a flag about a floor that ranked a field
                   * containing only zeros were both reporting on a mechanism that
                   * no longer decides anything. Reporting a dead number is worse
                   * than reporting nothing, which the rail learned once already.
                   */
                  directorSelections,
                  directorFallback,
                  catalogSize,
                },
              },
              isCurrent: true,
              costCents: Math.round(perImageUsd * 100),
            });
          }

          if (consumed.length > 0) {
            const [current] = await tx
              .select({ consumedFrom: stageStatesTable.consumedFrom })
              .from(stageStatesTable)
              .where(eq(stageStatesTable.id, stage.id));
            // Merge rather than replace, matching the takes endpoint: a stage that
            // consumed several inputs over several runs keeps all of its edges.
            const merged = new Set([...(current?.consumedFrom ?? []), ...consumed]);
            merged.delete(stage.id);
            await tx
              .update(stageStatesTable)
              .set({ consumedFrom: [...merged], decidedAt: new Date(), updatedAt: new Date() })
              .where(eq(stageStatesTable.id, stage.id));
          }
        });
      }


      res.json({
        outcomes,
        succeeded: succeeded.length,
        failed: outcomes.length - succeeded.length,
        costUsd: settled,
        generated: true,
        // §1.17: what actually reached the model, reported rather than implied.
        material: {
          referenceCount: references.length,
          subjectCount: references.filter(r => r.role === "subject_reference").length,
          styleCount: references.filter(r => r.role === "style_reference").length,
          director: persona?.name ?? null,
          personaNote: referenceNote,
          /*
           * Chosen and sent are different numbers, and the gap is where character
           * fidelity gets lost, so both are reported. `catalogSize` is how many
           * library assets the Director could see at all, which is the number that
           * makes a bad selection diagnosable without another paid round.
           */
          directorSelections,
          catalogSize,
          // The Director ran but could not produce parseable JSON, so its prose
          // was used with no asset selections. Said plainly: this is the
          // difference between a directed spread and a described one.
          directorFallback,
          // What the Director judged the format should be. NOT applied here: the
          // spread is a grid and stage 05 owns reframing, so acting on this would
          // change the grid's shape and pre-empt a stage that has not been built.
          suggestedAspectRatio: directorAspectRatio,
        },
      });
    } catch (err) {
      // Never leave a reservation behind: a phantom row would eat the daily
      // budget for work that never happened.
      if (reservationId) {
        try { await db.delete(costLogsTable).where(eq(costLogsTable.id, reservationId)); } catch { /* best effort */ }
      }
      console.error("Explore run failed", err);
      /*
       * Two different failures, two different truths, and conflating them was a
       * §1.14 violation waiting to happen.
       *
       * Before any image is requested, nothing has been billed and we can say so
       * flatly. That is the common case now that a Director outage aborts here
       * rather than degrading: the user gets their money back and a reason.
       *
       * Once generation has started, images that came back were already billed
       * upstream, so claiming nothing was charged would be the one thing worse
       * than the failure itself.
       */
      res.status(500).json({
        error: generationStarted
          ? "The spread could not be saved. Any images that had already been generated were still billed, and the cost has been recorded."
          : "The creative direction for this spread could not be produced, so nothing was generated and nothing was charged. Try again in a moment.",
      });
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
            .select({ slotKey: stageTakesTable.slotKey, takeIndex: stageTakesTable.takeIndex })
            .from(stageTakesTable)
            .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.slotKey, "selected")));
          await tx.insert(stageTakesTable).values({
            stageStateId: stageId,
            slotKey: "selected",
            takeIndex: nextTakeIndex(prior, "selected"),
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
          .select({ slotKey: stageTakesTable.slotKey, takeIndex: stageTakesTable.takeIndex })
          .from(stageTakesTable)
          .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.slotKey, slotKey)));
        await tx.insert(stageTakesTable).values({
          stageStateId: stageId,
          slotKey,
          takeIndex: nextTakeIndex(prior, slotKey),
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
