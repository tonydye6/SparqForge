import { extractLastFrame } from "../services/cut-render.js";
import { VEO_MODEL, runVeoVideo } from "../services/veo.js";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, appSettingsTable, assetsTable, brandsTable, costLogsTable, creativesTable, designerPersonasTable, sequenceClipsTable, sequencesTable, stageStatesTable, stageTakesTable, takeLayersTable, type DesignerPersona, type LayerKind } from "@workspace/db";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { AI_MODELS, COPILOT_MODELS, COST_ESTIMATES, DEFAULT_SPREAD_PASS, estimateGeminiTextCost, estimateImagenCost, estimateVideoDurationSeconds, imagePass, type ImagePassType } from "../lib/ai-config.js";

/**
 * The pass a spread renders at when the caller does not say. Phase 7 item 2.
 *
 * **"preview" as of 2026-08-08, on evidence rather than on the price list.**
 * Doc 30 §7 called two-pass "verified" when only the PRICE had been checked.
 * Two probes settled the rest:
 *
 *  - flash-lite accepts the same multi-image reference payload and holds
 *    subject identity — the character is recognisably the same person;
 *  - it renders in ~3.3s against pro's ~17.6s, so a spread of eight appears in
 *    a fifth of the time, which matters more day to day than the money;
 *  - across three briefs the trademark scanner found ZERO third-party marks in
 *    either tier. A single earlier flash-lite render had put legible Pepsi
 *    boards in a stadium background; six images later that looks like noise,
 *    and the exposure was always narrow because a preview is never the
 *    artifact — the keeper is re-rendered before anything ships.
 *
 * A spread of 8 previews plus one full render is **$0.40 against $1.07**.
 */
// Moved to lib/ai-config.ts when the storyboard's read model had to quote the
// same price this endpoint charges. The reasoning above stays next to the code
// that spends the money.

/**
 * How many takes a spread renders. Phase 7 item 4's "spread size control".
 *
 * Read fresh on every plan and every run rather than cached, so the two can
 * never disagree about the size — quoting eight and charging for six, or the
 * reverse, is the same class of lie as quoting the wrong tier.
 */
async function configuredSpreadSize(): Promise<number> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "spreadSize"));
  return normaliseSpreadSize(row?.value);
}
import { isIntent, INTENT_LABELS, type Intent } from "../lib/intents.js";
import { generationLimiter } from "../lib/rate-limit.js";
import { buildCostRow } from "../services/cost-recording.js";
import { monthToDateBudget, reserveBudget, budgetExceededBody } from "../lib/budget.js";
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
  findBestMarkAsset,
  loadBrand,
  mentionsMark,
  mergeReferenceSlots,
  slotDescriptionForAsset,
  wrapEditInstruction,
} from "../services/creative-direction.js";
import { mentionsDirectiveBlock, normalizeMentions, pinnedSubjectFrom, type BriefMention } from "../services/brief-mentions.js";
import { checkGenerationEligibility } from "../services/asset-policy.js";
import {
  buildDirectedPrompt,
  leadingSubjectRun,
  loadAssetIdReferences,
  loadDirectedReferences,
  orderReferences,
  type DirectedPromptInput,
} from "../services/explore-direction.js";
import { normalizeRegion, driftMessage, driftVerdict, DRIFT_TOLERANCE } from "../services/region-edit.js";
import {
  layerEditRefusal,
  layerMoveSentence,
  layerPromptReference,
  layerScopeSentence,
  markLayerSlotDescription,
  shouldCarryLayers,
  unionBox,
} from "../services/layer-detection.js";
import { measureDrift, describeRegion } from "../services/region-drift.js";
import { runImageInteraction, runVideoInteraction } from "../services/interactions-client.js";
import { beatPickSlotKey, buildBeatPlan, buildExplorePlan, normaliseSpreadSize } from "../services/explore-plan.js";
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
async function intentFromBrief(creativeId: string): Promise<{
  intent: Intent | null;
  briefStageId: string | null;
  briefText: string | null;
  briefTakeId: string | null;
  mentions: BriefMention[];
  /** The story path's decision, saved on the brief (step 4a). */
  shape: "single" | "sequence";
  shots: Array<{ n: number; text: string }>;
}> {
  const [brief] = await db
    .select({ id: stageStatesTable.id })
    .from(stageStatesTable)
    .where(and(eq(stageStatesTable.creativeId, creativeId), eq(stageStatesTable.stageKind, "brief")));
  if (!brief) {
    return {
      intent: null, briefStageId: null, briefText: null, briefTakeId: null,
      mentions: [], shape: "single", shots: [],
    };
  }

  const [take] = await db
    .select({ id: stageTakesTable.id, payload: stageTakesTable.payload })
    .from(stageTakesTable)
    .where(
      and(
        eq(stageTakesTable.stageStateId, brief.id),
        eq(stageTakesTable.slotKey, "brief"),
        eq(stageTakesTable.isCurrent, true),
      ),
    );

  const payload = take?.payload as {
    intentId?: unknown; line?: unknown; derived?: unknown; mentions?: unknown;
    shape?: unknown; shots?: unknown;
  } | null | undefined;
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
  /*
   * The assets the user attached with `@` in their own sentence. Validated here
   * rather than trusted: the takes route stores payload as z.unknown(), so this
   * is the boundary between a hand-written body and code that will try to load
   * whatever ids it is handed.
   */
  const mentions = normalizeMentions(payload && typeof payload === "object" ? payload.mentions : null);
  /*
   * The shot list, re-validated at the boundary for the same reason mentions
   * are: the takes route stores payload as z.unknown(), so a brief could carry
   * anything. A shot with no text is not a shot, and the numbering is rebuilt
   * here rather than trusted — beat slot keys are named off it.
   */
  const rawShots = payload && typeof payload === "object" && Array.isArray(payload.shots) ? payload.shots : [];
  const shots = rawShots
    .map(sh => (sh as { text?: unknown })?.text)
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t, i) => ({ n: i + 1, text: t.trim() }));
  const shape = payload?.shape === "sequence" && shots.length >= 2 ? "sequence" as const : "single" as const;
  return {
    intent: isIntent(raw) ? raw : null,
    briefStageId: brief.id,
    briefText,
    briefTakeId: take?.id ?? null,
    mentions,
    shape,
    shots,
  };
}

router.get("/creatives/:creativeId/explore-plan", async (req: Request, res: Response): Promise<void> => {
  const creativeId = String(req.params.creativeId);

  try {
    const { intent, briefStageId } = await intentFromBrief(creativeId);

    // No brief yet, or a brief saved before the goal was recorded. Planning
    // against a default is better than refusing to show the screen, but the
    // response says so rather than implying the axes were chosen for this post.
    const effective: Intent = intent ?? "awareness";

    /*
     * Price the plan from the SAME source the run will charge from.
     *
     * This route quoted `COST_ESTIMATES.IMAGEN_PER_IMAGE_USD` directly while the
     * run now prices through `imagePass(DEFAULT_SPREAD_PASS)`. They agree today
     * only because the default is "full" — the day that default flips, the
     * button would promise one price and the bill would be another. Quoting a
     * price the code does not charge is the fossil problem again, one level up.
     */
    const { model: passModel, usdPerImage } = imagePass(DEFAULT_SPREAD_PASS);
    /*
     * Per-run size (doc 41 item 12: "I shouldn't be required to generate 8
     * each time"). The query wins over the app setting; both pass through
     * normaliseSpreadSize, so plan and run can only ever disagree with a
     * caller that asked them different questions.
     */
    const requestedSize = typeof req.query.size === "string" ? req.query.size : null;
    const plan = buildExplorePlan({
      intent: effective,
      perImageUsd: usdPerImage,
      spreadSize: requestedSize !== null ? normaliseSpreadSize(requestedSize) : await configuredSpreadSize(),
    });

    /*
     * Phase 7 item 5 — the soft cap, answered BEFORE the turn.
     *
     * `wouldReachUsd` is month-to-date plus what this spread would add, so the
     * composer can say "this takes you over" rather than only reporting the
     * damage afterwards. A soft cap that you learn about after spending is a
     * receipt, not a control.
     *
     * `hard` is false and there is no hard-cap path here on purpose: doc 22 item
     * 5 asks for hard caps DEFAULT OFF, and the gate that actually refuses spend
     * already exists in `reserveBudget` against the DAILY threshold. Adding a
     * second refusing gate on the monthly number would be two things that can
     * say no, which is how a build ends up with a limit nobody can find.
     */
    const mtd = await monthToDateBudget();
    const spreadUsd = plan.costCents / 100;

    res.json({
      ...plan,
      goal: { id: effective, label: INTENT_LABELS[effective], fromBrief: intent !== null },
      briefStageId,
      pass: DEFAULT_SPREAD_PASS,
      model: passModel,
      budget: {
        monthSpentUsd: mtd.spentUsd,
        monthBudgetUsd: mtd.budgetUsd,
        wouldReachUsd: mtd.spentUsd + spreadUsd,
        wouldExceed: mtd.budgetUsd !== null && mtd.spentUsd + spreadUsd > mtd.budgetUsd,
        /**
         * Whether the cap will REFUSE this run rather than warn about it. The
         * composer needs to know the difference: a warning is advice, a hard cap
         * means the button will fail, and telling someone "you can still run it"
         * when they cannot would be worse than saying nothing.
         */
        hard: mtd.hard,
      },
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
    /*
     * Which pass this spread renders at. Phase 7 item 2. See
     * DEFAULT_SPREAD_PASS above for why the default is `preview`.
     *
     * BOTH values are accepted explicitly. An earlier cut read
     * `x === "preview" ? "preview" : DEFAULT`, which was fine only while the
     * default was `full`; the moment it flipped, a caller asking for `full`
     * would have silently got a preview instead. A request the code quietly
     * ignores is worse than one it rejects.
     */
    const requestedPass = (req.body as { pass?: unknown } | undefined)?.pass;
    const pass: ImagePassType =
      requestedPass === "preview" || requestedPass === "full" ? requestedPass : DEFAULT_SPREAD_PASS;
    const { model: passModel, usdPerImage: perImageUsd } = imagePass(pass);
    let reservationId: string | null = null;
    // Declared out here because the error handler needs it: it decides whether
    // "nothing was charged" is a true statement or a lie (§1.14).
    let generationStarted = false;
    /*
     * Whether the settle transaction actually committed. `generationStarted`
     * says money LEFT; this says whether we managed to write it down. They are
     * different facts and the error message needs both — a failure between them
     * is spend that exists on the vendor's bill and nowhere else.
     */
    let costSettled = false;

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

      const { intent, briefStageId, briefText, briefTakeId, mentions, shape, shots } =
        await intentFromBrief(creativeId);

      /*
       * ONE BEAT, or the whole spread (the story path, step 4b).
       *
       * A beat runs through this same endpoint on purpose. Everything below the
       * plan — the Director call, the identity lock, the marks rule, the subject
       * pin, the budget reservation, the per-take cost rows, the slot-per-take
       * history — is already correct and already walked, and a second route
       * would be a second copy of it to keep in agreement. So a beat is simply
       * a two-take plan whose ids are its own slot family.
       */
      const requestedBeat = (req.body as { beat?: unknown } | undefined)?.beat;
      const beat = typeof requestedBeat === "number" && Number.isInteger(requestedBeat) ? requestedBeat : null;
      const steering = typeof (req.body as { steering?: unknown } | undefined)?.steering === "string"
        ? ((req.body as { steering?: string }).steering ?? "").slice(0, 400)
        : null;

      if (beat !== null) {
        // Refused BEFORE the reservation, and by name. A beat that is not on the
        // shot list would otherwise generate two images of nothing in
        // particular and bill for them.
        if (shape !== "sequence") {
          res.status(400).json({
            error: "This post is one picture, not a sequence, so it has no beats. Nothing was charged.",
          });
          return;
        }
        const shot = shots.find(sh => sh.n === beat);
        if (!shot) {
          res.status(400).json({
            error: `This story has ${shots.length} shot${shots.length === 1 ? "" : "s"}, so there is no beat ${beat}. Nothing was charged.`,
          });
          return;
        }
      }

      // The size the run banner quoted (doc 41 item 12); same normalisation as
      // the plan, so the price shown and the price charged agree.
      const requestedSize = (req.body as { spreadSize?: unknown } | undefined)?.spreadSize;
      const fullPlan = beat !== null
        ? buildBeatPlan({
            beat,
            text: shots.find(sh => sh.n === beat)!.text,
            totalBeats: shots.length,
            steering,
            perImageUsd,
          })
        : buildExplorePlan({
            intent: intent ?? "awareness",
            perImageUsd,
            spreadSize: requestedSize !== undefined && requestedSize !== null
              ? normaliseSpreadSize(requestedSize)
              : await configuredSpreadSize(),
          });

      /*
       * Debug override: run a subset of the spread.
       *
       * A spread is a PRODUCT feature; it is a terrible debugging tool. Nine of
       * them were bought at $0.48 chasing a character-fidelity bug whose fix is
       * visible in a single take, and 25_GENERATION_ARCHITECTURE §6 asked for
       * this after the fifth. One take is $0.06, so a prompt change can be
       * judged for an eighth of the price.
       *
       * Deliberately not exposed in the Studio UI. The spread's whole argument
       * is that seeing alternatives together is what makes choosing possible
       * (24_DESIGN_INTENT §2), so a "just do one" button in the product would
       * quietly rebuild the slot machine. This is an API-level tool.
       */
      const debugTakeIds = Array.isArray(req.body?.takeIds)
        ? (req.body.takeIds as unknown[]).filter((t): t is string => typeof t === "string")
        : null;
      const plan = debugTakeIds && debugTakeIds.length > 0
        ? { ...fullPlan, takes: fullPlan.takes.filter(t => debugTakeIds.includes(t.id)) }
        : fullPlan;

      if (plan.takes.length === 0) {
        res.status(400).json({
          error: `None of the requested takeIds exist in this spread. Valid ids: ${fullPlan.takes.map(t => t.id).join(", ")}. Nothing was charged.`,
        });
        return;
      }

      /*
       * The monthly HARD cap. Phase 7 item 5, and off unless somebody turned it
       * on. Checked before the reservation so a refused run holds nothing.
       *
       * Refusing here and warning in the composer are the same number read two
       * ways, which is deliberate: the warning is what you see while deciding,
       * this is what happens if the cap has been made binding. When it is off —
       * the default — this branch cannot fire at all and the daily threshold
       * below remains the only thing that says no.
       */
      const monthly = await monthToDateBudget();
      const spreadUsd = plan.takes.length * perImageUsd;
      if (monthly.hard && monthly.budgetUsd !== null && monthly.spentUsd + spreadUsd > monthly.budgetUsd) {
        res.status(429).json({
          error: "Monthly budget exceeded",
          monthSpend: monthly.spentUsd,
          threshold: monthly.budgetUsd,
          wouldReach: monthly.spentUsd + spreadUsd,
          message:
            `This spread would take the month to $${(monthly.spentUsd + spreadUsd).toFixed(2)}, ` +
            `past the $${monthly.budgetUsd.toFixed(2)} monthly limit. Nothing was generated and ` +
            `nothing was charged. Raise or turn off the monthly limit in Cost Dashboard settings.`,
        });
        return;
      }

      // Reserve for what will ACTUALLY run, not for the full spread, or a
      // one-take debug run would hold $0.48 of headroom it never spends.
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
        /*
       * The subject this brief already settled on, if the user did not name one.
       *
       * Selection is a model call at temperature 0.7, so re-running the same
       * brief could put a different character in the picture: the probe chose
       * one Crown U football character and a paid run minutes later chose
       * another. A spread explores COMPOSITION, so the one thing that must not
       * vary across it, or across a re-run of it, is who is in the picture.
       *
       * Inherited only while the brief behind it is unchanged, and always
       * beaten by an `@` mention: a pin is a memory of a guess, a mention is a
       * statement of fact. It is expressed AS a mention so it travels through
       * exactly the same machinery rather than growing a second path.
       */
      /*
       * Mentions pass the SAME gate the director's catalog does, before they
       * can steer anything.
       *
       * Found by running the identical brief through both stacks: the legacy
       * Co-pilot's picker refused crownu_char_female_blue_tennis ("Not
       * approved for AI generation" — the analysis flagged the Nike swoosh on
       * her chest), while this path attached her and rendered a spread from
       * her. An explicit human mention is still AI reference use; the flag and
       * the trademark gate exist precisely for the asset somebody most wants
       * to use. Dropping is RECORDED, never silent: the run proceeds on the
       * director's own pick and the payload names what fell out and why.
       */
      const mentionGateContext = { channel: null, template: creative.templateId ?? null };
      const droppedMentions: Array<{ name: string; reason: string }> = [];
      const mentionRows = await loadBrandAssetsByIds(creative.brandId, mentions.map(m => m.assetId));
      const mentionRowById = new Map(mentionRows.map(a => [a.id, a]));
      const allowedMentions = mentions.filter((mn) => {
        const row = mentionRowById.get(mn.assetId);
        if (!row) {
          droppedMentions.push({ name: mn.name, reason: "No longer in this brand's library" });
          return false;
        }
        const verdict = checkGenerationEligibility(
          row,
          mentionGateContext,
          mn.role === "object" ? "compositing" : "generation_reference",
        );
        if (!verdict.eligible) {
          droppedMentions.push({ name: mn.name, reason: verdict.reason ?? "Not eligible" });
          return false;
        }
        return true;
      });

      let subjectPinnedFrom: "mention" | "previous run" | null =
        allowedMentions.some(m => m.role === "subject") ? "mention" : null;
      const effectiveMentions: BriefMention[] = [...allowedMentions];

      if (!subjectPinnedFrom) {
        const priorTakes = await db
          .select({ payload: stageTakesTable.payload })
          .from(stageTakesTable)
          .where(and(eq(stageTakesTable.stageStateId, stage.id), eq(stageTakesTable.isCurrent, true)));
        const pinnedId = pinnedSubjectFrom(priorTakes, briefTakeId);
        if (pinnedId) {
          const [pinnedAsset] = await loadBrandAssetsByIds(creative.brandId, [pinnedId]);
          if (pinnedAsset) {
            // An inherited pin is a mention by another name, so it passes the
            // same gate — an asset blocked since the last run must not keep
            // steering generation through its own memory.
            const verdict = checkGenerationEligibility(pinnedAsset, mentionGateContext, "generation_reference");
            if (verdict.eligible) {
              effectiveMentions.push({ assetId: pinnedAsset.id, name: pinnedAsset.name, role: "subject" });
              subjectPinnedFrom = "previous run";
            } else {
              droppedMentions.push({ name: pinnedAsset.name, reason: verdict.reason ?? "Not eligible" });
            }
          }
        }
      }

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
        // What the user attached with `@`. The director has to know, or it picks
        // a SECOND subject and the renderer is handed two people and asked to
        // invent how they relate.
        extraContext: mentionsDirectiveBlock(effectiveMentions),
      });
      /*
       * The director's own turn, billed beside the images it directs. Every
       * spread paid this call and no ledger row said so (doc 39 §5.1). Best
       * effort: a failed insert never fails the spread the user paid for.
       */
      try {
        await db.insert(costLogsTable).values(buildCostRow({
          creativeId,
          brandId: creative.brandId,
          service: "gemini",
          operation: "creative_direction",
          model: COPILOT_MODELS.ART_DIRECTION_MODEL,
          costUsd: estimateGeminiTextCost(),
        }));
      } catch (costErr) {
        console.error("Cost row for creative_direction could not be written", costErr);
      }
      directorSelections = direction.assetSelections;
      /*
       * Whoever ended up being the subject: the user's mention, the pin
       * inherited from the previous run, or, failing both, the director's own
       * pick this run. Recorded on every take so the NEXT run inherits it and
       * the spread stops changing its mind about who is in the picture.
       */
      const pinnedSubjectId =
        effectiveMentions.find(m => m.role === "subject")?.assetId ??
        direction.assetSelections.find(sel => sel.role === "subject")?.assetId ??
        null;
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
        /*
         * `@` mentions first, because they are the most explicit statement of
         * intent the product has.
         *
         * Stage 03 can select a subject well, but it cannot know which character
         * "Travis Dye" is when no asset carries that name: it was guessing
         * between football characters, and guessing differently each run. A
         * mention removes the guess. It enters as an ATTACHMENT, which is the top
         * of the priority order, so it outranks the director's own pick and lands
         * at the front of the reference list where the identity lock points.
         *
         * loadDirectedReferences is reused verbatim rather than copied: a mention
         * is {assetId, role} and so is a director selection, and it already
         * orders subject before mark before style, which is what makes the lock's
         * "attached image 1" true.
         */
        const mentionAssets = await loadBrandAssetsByIds(
          creative.brandId,
          effectiveMentions.map(m => m.assetId),
        );
        const mentionById = new Map(mentionAssets.map(a => [a.id, a]));
        const mentioned = await loadDirectedReferences(effectiveMentions, mentionById);

        // A mark counts whether the user attached it or the director chose it.
        hasMarkReference = directed.hasMark || mentioned.hasMark;

        const creativeSelected = ((creative.selectedAssets || []) as Array<{ assetId?: string }>)
          .map(a => a.assetId)
          .filter((id): id is string => typeof id === "string");
        const attachedRefs = [
          ...mentioned.references,
          ...(await loadAssetIdReferences(
            await loadBrandAssetsByIds(creative.brandId, creativeSelected),
            "subject_reference",
          )),
        ];
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

        /*
         * The identity lock's claim has to be true of the FINAL merged list, not
         * of what the director picked, because attachments and style-profile
         * references can land ahead of the director's subject. leadingSubjectRun
         * counts only the unbroken run of locked subjects at the front.
         */
        const subjectAssetIds = new Set([
          ...effectiveMentions.filter(m => m.role === "subject").map(m => m.assetId),
          ...direction.assetSelections.filter(s => s.role === "subject").map(s => s.assetId),
        ]);

        promptInputs = {
          directorPrompt: direction.prompt,
          styleContract,
          overflowBlock: buildOverflowDescriptors(overflow),
          references,
          hasMarkReference,
          subjectReferenceCount: leadingSubjectRun(references, subjectAssetIds),
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
      /*
       * The resolved prompt per take, kept so promotion can render the keeper at
       * full resolution FROM THE SAME INSTRUCTION. Without it, "render the keep"
       * would have to rebuild the prompt by re-running the Creative Director —
       * a second model call, and one that could legitimately decide something
       * different, so the full render would not be the take the user chose.
       */
      const promptFor = new Map<string, string>();
      const results = await mapWithConcurrency(plan.takes, RUN_CONCURRENCY, async (take) => {
        const renderPrompt = buildDirectedPrompt({
          ...effectivePromptInputs,
          axisDirective: take.directive,
        });
        promptFor.set(take.id, renderPrompt);
        const image = await generateImageFromPrompt(
          renderPrompt,
          "instagram_feed",
          references,
          passModel,
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
      /*
       * ONE COST ROW PER IMAGE, not one per spread. Phase 7 item 2.
       *
       * The old single row is what made waste unreportable: a spread of eight
       * shared one `wasUsed`, which could not describe the kept take and the
       * seven culled ones at the same time without lying about one of them.
       *
       * `wasUsed` starts FALSE on a preview pass and NULL on a full one. False
       * is the truth at this instant — nothing has been promoted yet — and it
       * means the waste figure is honest from the moment the money is spent
       * rather than only after somebody tidies up. A full-pass spread is not
       * part of a two-pass flow at all, and NULL says exactly that.
       */
      /*
       * Declared HERE, above the settle, and not further down where it used to
       * live. Moving the cost rows onto a per-take footing made this block the
       * first reader of the successful outcomes, and leaving the declaration
       * below it threw `Cannot access 'succeeded' before initialization` —
       * after the images had already been generated and billed. The whole point
       * of settling first is that the money survives a later failure; a
       * reference error in the settle itself defeats that.
       */
      const succeeded = outcomes.filter(o => o.ok);

      const spreadCostRowIds: string[] = [];
      await db.transaction(async (tx) => {
        if (reservationId) await tx.delete(costLogsTable).where(eq(costLogsTable.id, reservationId));
        for (const _ of succeeded) {
          const [row] = await tx
            .insert(costLogsTable)
            .values(buildCostRow({
              creativeId,
              brandId: creative.brandId,
              service: "gemini",
              operation: "explore_spread",
              model: passModel,
              costUsd: perImageUsd,
              passType: pass,
              wasUsed: pass === "preview" ? false : null,
              // The take does not exist yet and the FK would reject it. Linked
              // in the take transaction below; see the note there for why the
              // money still goes in first.
            }))
            .returning({ id: costLogsTable.id });
          if (row) spreadCostRowIds.push(row.id);
        }
      });
      costSettled = true;
      reservationId = null;

      // Record every take that produced an image. A slot per take id, so a
      // re-run of one take supersedes only itself.
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
          for (const [i, o] of succeeded.entries()) {
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
                /*
                 * What this take was rendered at, and what it would take to
                 * render it again. Promotion reads both: `pass` to know whether
                 * a full render is still owed, `renderPrompt` to ask for the
                 * same picture rather than a new one.
                 */
                pass,
                renderPrompt: promptFor.get(o.takeId) ?? null,
                // Recorded on the take, not just returned, so the Material rail
                // can state what this image was actually made from long after the
                // run response is gone (§1.17).
                material: {
                  referenceCount: references.length,
                  /*
                   * REFERENCE LANES, not director roles, and the two do not
                   * agree. imagen has exactly two lanes, so a brand mark rides
                   * the subject lane: the first live spread recorded
                   * subjectCount 2 for a director that chose one character and
                   * one logo. Anything user-facing must read roles off
                   * directorSelections below; these two are for diagnosing what
                   * was actually attached.
                   */
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
                  /*
                   * Who was in this picture, and which brief decided it. The next
                   * run reads this back so a spread does not change its subject
                   * between runs of the same brief. Scoped to briefTakeId so a
                   * rewritten brief is free to choose again.
                   */
                  subjectPin: pinnedSubjectId ? { assetId: pinnedSubjectId, briefTakeId } : null,
                  subjectPinnedFrom,
                  /*
                   * Mentions the eligibility gate refused, with the gate's own
                   * reason. Falling back is allowed; falling back quietly is
                   * not — this is how a user learns their named character was
                   * blocked (trademark, owner opt-out) rather than ignored.
                   */
                  droppedMentions,
                },
              },
              isCurrent: true,
              /*
               * Kept for the surfaces that already read it, but it is NOT the
               * waste ledger. Integer cents cannot hold a $0.0336 preview: it
               * rounds to 3c, ~10% out on the number Phase 7 exists to report.
               * `cost_logs.costUsd` is numeric(12,4) and is the record.
               */
              costCents: Math.round(perImageUsd * 100),
            }).returning({ id: stageTakesTable.id }).then(async ([inserted]) => {
              /*
               * Link the money to the take it bought.
               *
               * This is an UPDATE rather than a value on the insert above
               * because the cost rows went in first, in their own transaction,
               * and the FK would have rejected a take id that did not exist
               * yet. The ordering is deliberate and predates this change: these
               * images were already billed upstream the moment the calls
               * returned, so settling after the takes meant a failure while
               * recording takes rolled the settlement back and the money
               * vanished from cost_logs while still having left the account.
               *
               * If this update is what fails, the money is still recorded and
               * only its take link is missing. That is the right direction to
               * fail in: an unattributed cost is a reporting gap, a lost cost is
               * a lie about the bill.
               */
              const costRowId = spreadCostRowIds[i];
              if (inserted && costRowId) {
                await tx
                  .update(costLogsTable)
                  .set({ stageTakeId: inserted.id })
                  .where(eq(costLogsTable.id, costRowId));
              }
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
        costUsd: settledCostUsd(outcomes, perImageUsd),
        /*
         * What this spread was rendered at, said out loud in the response.
         * A caller that gets preview-tier images back for preview-tier money
         * should not have to infer which it got from the price.
         */
        pass,
        model: passModel,
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
          // Where the subject came from: named by the user, inherited from the
          // previous run of this brief, or chosen fresh by the director.
          subjectPinnedFrom,
          // Mentions the eligibility gate refused, with the gate's reason —
          // the response-level copy of the per-take record above.
          droppedMentions,
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
       *
       * BUT IT MUST NOT CLAIM THE COST WAS RECORDED EITHER. This message used to
       * end "and the cost has been recorded", and a live failure proved that
       * false: a reference error thrown INSIDE the settle transaction rolled
       * back the very inserts the sentence was promising, so four billed images
       * left no row at all. `costSettled` reports what actually happened rather
       * than what the happy path intends.
       */
      res.status(500).json({
        costSettled,
        error: generationStarted
          ? costSettled
            ? "The spread could not be saved. Any images already generated were still billed, and that cost has been recorded."
            : "The spread could not be saved. Images had already been generated and billed, and the cost could NOT be recorded — this spend is missing from the Cost surface."
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
 * The refine target is a COLUMN on the stage row, not a take. "Selected"
 * takes are reserved for actual picks — the ones with an image — because
 * three surfaces read that slot as "the chosen picture" and a target pointer
 * in there un-published a finished post once already (doc 40 P0.1).
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

      /*
       * A mode target is stage state, NOT a decision. The first version
       * recorded it as a current take in the "selected" slot — a pointer take
       * with no imageUrl — and everything that reads that slot as "the pick"
       * (the ship bar, the publish checks, the Smart Bar's take_picked event)
       * saw the pick vanish: one click on "Refine" walked a shipped post back
       * to "cannot publish" (doc 40 P0.1). The target lives on the stage row
       * now; migration 0042 repaired the pointer takes this had written.
       */
      await db
        .update(stageStatesTable)
        .set({ mode, modeSlotKey: mode === "refine" ? (slotKey ?? null) : null, updatedAt: new Date() })
        .where(eq(stageStatesTable.id, stageId));

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
/**
 * Refine the whole take with a sentence — the Co-pilot's chat loop, living
 * inside stage 03 where Tony asked for it ("the studio v1 chat box + media
 * preview refinement step should be available after the best of 8 is
 * selected", doc 38 §6.3; doc 40 P0.3 found Refine was region-edit only).
 *
 * Same machinery as the region edit below, minus the geometry: the brand
 * contract wraps the instruction, the result is a NEW take in the same slot's
 * history (nothing is overwritten, restore stays free), and the money is a
 * budget-reserved single image charge stated in the UI before the press.
 *
 * `mentions` are `@` attachments typed into the instruction. They pass the
 * SAME eligibility gate the spread's mentions do — an edit is still AI
 * reference use — and enter the model as reference slots beside the image
 * being edited (subject→character, mark→object, style→style).
 */
const RefineEditBody = z.object({
  slotKey: z.string().min(1).max(64),
  instruction: z.string().min(1).max(1000),
  mentions: z
    .array(z.object({
      assetId: z.string().min(1),
      name: z.string().min(1),
      role: z.enum(["subject", "style", "object"]),
    }))
    .max(4)
    .optional(),
});

router.post(
  "/creatives/:creativeId/stages/:stageId/refine-edit",
  requireStandardWrite,
  generationLimiter,
  validateRequest({ body: RefineEditBody }),
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const stageId = String(req.params.stageId);
    const { slotKey, instruction, mentions = [] } = req.body as z.infer<typeof RefineEditBody>;
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
        .select({ id: stageTakesTable.id, payload: stageTakesTable.payload })
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
        res.status(400).json({ error: "That take has no image to refine, so nothing was charged." });
        return;
      }
      const beforeBuffer = await readFileByUrl(beforeUrl);
      if (!beforeBuffer) {
        res.status(400).json({ error: "The image for that take could not be read, so nothing was charged." });
        return;
      }

      // The same gate the spread's mentions pass, refusals named the same way.
      const mentionRows = await loadBrandAssetsByIds(creative.brandId, mentions.map(m => m.assetId));
      const mentionRowById = new Map(mentionRows.map(a => [a.id, a]));
      const droppedMentions: Array<{ name: string; reason: string }> = [];
      const allowed = mentions.filter((mn) => {
        const row = mentionRowById.get(mn.assetId);
        if (!row) {
          droppedMentions.push({ name: mn.name, reason: "No longer in this brand's library" });
          return false;
        }
        const verdict = checkGenerationEligibility(
          row,
          { channel: null, template: creative.templateId ?? null },
          mn.role === "object" ? "compositing" : "generation_reference",
        );
        if (!verdict.eligible) {
          droppedMentions.push({ name: mn.name, reason: verdict.reason ?? "Not eligible" });
          return false;
        }
        return true;
      });

      const budget = await reserveBudget(creativeId, estimateImagenCost(1));
      if (!budget.ok) {
        res.status(429).json(budgetExceededBody(budget.todaySpend, budget.threshold));
        return;
      }
      reservationId = budget.reservationId;

      const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, creative.brandId));
      const persona = await directorFor(creativeId, creative.brandId);
      const contract = brand ? buildSessionStyleContract({ brand, persona }) : "";
      const prompt = wrapEditInstruction(contract, instruction.trim());

      const slotFor = { subject: "character", object: "object", style: "style" } as const;
      const referenceSlots = [] as Array<{ imageBuffer: Buffer; mimeType: string; slot: "character" | "object" | "style"; description: string }>;
      for (const mn of allowed) {
        const row = mentionRowById.get(mn.assetId);
        const url = row?.fileUrl;
        if (typeof url !== "string") continue;
        const buf = await readFileByUrl(url);
        if (!buf) {
          droppedMentions.push({ name: mn.name, reason: "The reference image could not be read" });
          continue;
        }
        referenceSlots.push({
          imageBuffer: buf,
          mimeType: (row?.mimeType as string) || "image/png",
          slot: slotFor[mn.role],
          // The shared description carries the fidelity contract for the slot's
          // class — reproduce-exactly for a mark, identity-faithful for a
          // subject. The old flat "attached by the user" line said neither, so
          // an @-attached logo arrived with no instruction to copy it.
          description: `${slotDescriptionForAsset(row!, slotFor[mn.role])} Attached by the user for this edit.`,
        });
      }

      /*
       * STRICT MARKS, correction half (doc 41 item 4c): an instruction that
       * NAMES a mark ("add the chest logo") with no mark image attached used to
       * reach the model as prose alone, and prose is how marks get invented.
       * Attach the brand's real mark so the correction copies pixels.
       */
      let autoAttachedMark: string | null = null;
      // The id as well as the name: the name is what the rail SHOWS, the id is
      // what makes the mark a cast member the layer list can resolve to a file.
      let autoAttachedMarkId: string | null = null;
      if (mentionsMark(instruction) && !referenceSlots.some(s => s.slot === "object")) {
        const mark = await findBestMarkAsset({
          brandId: creative.brandId,
          text: instruction,
          template: creative.templateId ?? null,
        });
        const markBuf = mark?.fileUrl ? await readFileByUrl(mark.fileUrl) : null;
        if (mark && markBuf) {
          referenceSlots.push({
            imageBuffer: markBuf,
            mimeType: (mark.mimeType as string) || "image/png",
            slot: "object",
            description: `${slotDescriptionForAsset(mark, "object")} Attached automatically because the instruction names a mark.`,
          });
          autoAttachedMark = mark.name;
          autoAttachedMarkId = mark.id;
        }
      }

      const result = await runImageInteraction({
        prompt,
        slots: [
          { imageBuffer: beforeBuffer, mimeType: "image/png", slot: "object", description: "The image being refined. Apply the instruction to this image." },
          ...referenceSlots,
        ],
      });

      const filename = takeFilename(creativeId, `${slotKey}_refine`, crypto.randomUUID().slice(0, 8));
      await writeBuffer("generated", filename, result.imageBuffer);
      const afterUrl = `/api/files/generated/${filename}`;

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
            /*
             * WHICH take this was made from, not just which picture. The layer
             * read model walks this to carry the cast across an edit, and after
             * somebody restores an earlier take and refines it, the previous
             * take by INDEX is not this one's parent.
             */
            sourceTakeId: current?.id ?? null,
            instruction: instruction.trim(),
            // The whole image was fair game; the null region is how the deck
            // tells a prose refine from a boxed edit.
            region: null,
            mentions: allowed,
            droppedMentions,
            material: {
              referenceCount: 1 + referenceSlots.length,
              director: persona?.name ?? null,
              // Disclosed, because material that was sent without being shown
              // is the exact lie the rail exists to prevent (doc 24 §2).
              autoAttachedMark,
              /*
               * What THIS edit attached, in the shape the spread records, so
               * the layer list treats an @-mentioned character or an
               * auto-attached mark as this take's own cast rather than as
               * something carried forward from before it.
               */
              directorSelections: [
                ...allowed.map(mn => ({ role: mn.role, assetId: mn.assetId })),
                ...(autoAttachedMarkId ? [{ role: "object" as const, assetId: autoAttachedMarkId }] : []),
              ],
            },
          },
          isCurrent: true,
          costCents: Math.round(estimateImagenCost(1) * 100),
        });

        if (reservationId) await tx.delete(costLogsTable).where(eq(costLogsTable.id, reservationId));
        await tx.insert(costLogsTable).values(buildCostRow({
          creativeId,
          brandId: creative.brandId,
          service: "gemini",
          operation: "refine_edit",
          model: AI_MODELS.GEMINI_FLASH_IMAGE,
          costUsd: estimateImagenCost(1),
        }));
      });
      reservationId = null;

      res.json({ imageUrl: afterUrl, droppedMentions });
    } catch (err) {
      if (reservationId) {
        try { await db.delete(costLogsTable).where(eq(costLogsTable.id, reservationId)); } catch { /* best effort */ }
      }
      console.error("Refine edit failed", err);
      res.status(500).json({ error: "That refinement could not be made. Nothing was charged." });
    }
  },
);

/**
 * Animate the PICK — motion made inside stage 03, where doc 24 §3 put it
 * (motion is a MEDIUM of this stage, not a stage). Until now the Motion tab's
 * only content was a note sending people back to the legacy Co-pilot, because
 * this route did not exist (doc 40 P0.4).
 *
 * The still is never consumed: the clip lands as a take in the `motion` slot,
 * the pick stays exactly where it was, and ship carries the clip beside the
 * image on every channel version (`mediumType`, M4's columns). The clip is
 * always animated FROM the current pick, so "this clip is the still in
 * motion" is true by construction.
 */
const MotionConvertBody = z.object({
  instruction: z.string().max(1000).optional(),
  /**
   * Which slot's current take to animate. Defaults to the pick ("selected") —
   * the quick path. The Sequence tab passes any slot, because a story's shots
   * are born from takes the pick never was (doc 42: animate-any-take).
   */
  slotKey: z.string().min(1).max(64).optional(),
  /**
   * When set, the clip is FOR this sequence: the video lands as its own
   * clip_* take (the motion slot is untouched) and is appended as a
   * studio_take clip at the end of the sequence.
   */
  sequenceId: z.string().min(1).max(64).optional(),
  /**
   * Which BEAT of the story this animates (step 4c). Its picked still is the
   * source, so a beat animates the frame somebody actually kept.
   */
  beat: z.number().int().min(1).max(12).optional(),
  /**
   * Seed this beat with the FINAL FRAME of the previous beat's clip.
   *
   * Frame chaining, and it needs no new model: the story literally begins where
   * the previous shot ended. The beat's own picked still still rides along as a
   * reference, so the composition somebody chose is not thrown away — it guides
   * instead of seeding, and the take says which it did.
   */
  chainFromPreviousBeat: z.boolean().optional(),
  /**
   * End this shot on the NEXT beat's picked still (step 5).
   *
   * This is the one control that ROUTES. Omni cannot pin an end frame — probed,
   * see services/veo.ts — so a shot that asks for one is rendered by Veo 3.1
   * Fast instead, and the take says which engine and why. There is no model
   * dropdown: the shot declares what it needs and the router obeys.
   */
  endOnNextBeat: z.boolean().optional(),
});

router.post(
  "/creatives/:creativeId/stages/:stageId/motion-convert",
  requireStandardWrite,
  generationLimiter,
  validateRequest({ body: MotionConvertBody }),
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const stageId = String(req.params.stageId);
    const { instruction, slotKey, sequenceId, beat, chainFromPreviousBeat, endOnNextBeat } =
      req.body as z.infer<typeof MotionConvertBody>;
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
        .where(and(eq(stageStatesTable.id, stageId), eq(stageStatesTable.creativeId, creativeId)));
      if (!stage) {
        res.status(404).json({ error: "Stage not found on this creative" });
        return;
      }
      if (stage.status === "locked") {
        res.status(409).json({
          error: "This stage is locked, so nothing was made and nothing was charged. Unlock it first.",
          stageStatus: "locked",
        });
        return;
      }

      /*
       * Which still to animate: the pick by default, any slot's current take
       * when the Sequence tab says so, and a BEAT's own pick when the
       * storyboard says so. A beat's pointer take lives in `beat{n}` exactly
       * as the single-picture pick lives in `selected`, so this is the same
       * lookup with a different slot name.
       */
      const sourceSlot = typeof beat === "number" ? beatPickSlotKey(beat) : (slotKey ?? "selected");
      const [picked] = await db
        .select({ id: stageTakesTable.id, payload: stageTakesTable.payload })
        .from(stageTakesTable)
        .where(
          and(
            eq(stageTakesTable.stageStateId, stageId),
            eq(stageTakesTable.slotKey, sourceSlot),
            eq(stageTakesTable.isCurrent, true),
          ),
        );
      const stillUrl = (picked?.payload as { imageUrl?: unknown } | undefined)?.imageUrl;
      if (typeof stillUrl !== "string") {
        res.status(400).json({
          error: typeof beat === "number"
            ? `Beat ${beat} has no picked still yet, so there is nothing to animate. Pick one on the storyboard first.`
            : sourceSlot === "selected"
              ? "Pick a take first. Motion animates the picked still, so there is nothing to animate yet."
              : "That take has no image, so there is nothing to animate.",
        });
        return;
      }

      // The sequence has to be this creative's before anything is charged.
      if (sequenceId) {
        const [seq] = await db
          .select({ id: sequencesTable.id })
          .from(sequencesTable)
          .where(and(eq(sequencesTable.id, sequenceId), eq(sequencesTable.creativeId, creativeId)));
        if (!seq) {
          res.status(404).json({ error: "That sequence is not on this post, so nothing was charged." });
          return;
        }
      }
      const stillBuffer = await readFileByUrl(stillUrl);
      if (!stillBuffer) {
        res.status(400).json({ error: "The picked image could not be read, so nothing was charged." });
        return;
      }

      /*
       * FRAME CHAINING (step 4c). The seed becomes the final frame of the
       * previous beat's clip, so this shot literally begins where that one
       * ended — no new model needed, because Omni already takes a first frame.
       *
       * Degrades rather than refuses. A chain that cannot be made (no previous
       * clip, unreadable bytes, ffmpeg absent) falls back to the beat's own
       * still and RECORDS WHY, because an animation that silently did not chain
       * looks identical to one that did until somebody watches the cut.
       */
      let seedBuffer = stillBuffer;
      let chainedFromClip: string | null = null;
      let chainRefused: string | null = null;
      if (chainFromPreviousBeat && typeof beat === "number") {
        if (beat <= 1) {
          chainRefused = "beat 1 has nothing before it to continue from";
        } else {
          const previousClip = await db
            .select({ payload: stageTakesTable.payload })
            .from(stageTakesTable)
            .where(and(
              eq(stageTakesTable.stageStateId, stageId),
              eq(stageTakesTable.isCurrent, true),
            ));
          const prior = previousClip
            .map(t => t.payload as { videoUrl?: unknown; beat?: unknown } | null)
            .find(pl => typeof pl?.videoUrl === "string" && pl?.beat === beat - 1);
          const priorUrl = typeof prior?.videoUrl === "string" ? prior.videoUrl : null;
          const priorBytes = priorUrl ? await readFileByUrl(priorUrl) : null;
          const frame = priorBytes ? await extractLastFrame(priorBytes) : null;
          if (frame) {
            seedBuffer = frame;
            chainedFromClip = priorUrl;
          } else {
            chainRefused = priorUrl
              ? `beat ${beat - 1}'s clip could not be read for its last frame`
              : `beat ${beat - 1} has not been animated yet`;
          }
        }
      }

      // Reserved at the longest clip the model produces; the final row bills
      // the seconds that actually came back, the way the Co-pilot always has.
      const reserveUsd = 8 * COST_ESTIMATES.VIDEO_COST_PER_SECOND_USD;
      const budget = await reserveBudget(creativeId, reserveUsd);
      if (!budget.ok) {
        res.status(429).json(budgetExceededBody(budget.todaySpend, budget.threshold));
        return;
      }
      reservationId = budget.reservationId;

      /*
       * THE PINNED END FRAME (step 5), and the routing decision it makes.
       *
       * "End on the next moment" is what an end-frame pin is FOR in a story, so
       * the pin is the NEXT beat's picked still rather than a free-floating take
       * picker: it needs no new surface, and it is the shot travelling from this
       * moment to the one after it. No pick on the next beat means no pin, said
       * by name rather than silently ignored.
       */
      let endFrameBuffer: Buffer | null = null;
      let endPinRefused: string | null = null;
      if (endOnNextBeat && typeof beat === "number") {
        const [nextPick] = await db
          .select({ payload: stageTakesTable.payload })
          .from(stageTakesTable)
          .where(and(
            eq(stageTakesTable.stageStateId, stageId),
            eq(stageTakesTable.slotKey, beatPickSlotKey(beat + 1)),
            eq(stageTakesTable.isCurrent, true),
          ));
        const nextUrl = (nextPick?.payload as { imageUrl?: unknown } | undefined)?.imageUrl;
        const nextBytes = typeof nextUrl === "string" ? await readFileByUrl(nextUrl) : null;
        if (nextBytes) endFrameBuffer = nextBytes;
        else {
          endPinRefused = typeof nextUrl === "string"
            ? `beat ${beat + 1}'s still could not be read`
            : `beat ${beat + 1} has no picked still to end on`;
        }
      } else if (endOnNextBeat) {
        endPinRefused = "only a beat of a story can end on the next moment";
      }

      /*
       * The identity lock, ported to motion (doc 41 item 6).
       *
       * The old prompt here was one generic sentence with no identity or style
       * lock and no reference imagery, and Tony's walk showed exactly what that
       * buys: the clip morphs the character off their stylized game design
       * toward realism. Same failure class as the stage 03 spread before its
       * lock — the last-mile prompt was lazy. So motion gets the same three
       * protections the image path earned: the lock leads (position beats
       * wording), the character reference rides along as an attached image, and
       * the brand contract (which now carries the neon ban) closes the prompt.
       */
      const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, creative.brandId));
      const persona = await directorFor(creativeId, creative.brandId);
      const contract = brand ? buildSessionStyleContract({ brand, persona }) : "";

      // The pick's subject, via the pin the spread records on every take. The
      // picked take's own material wins; any current take's pin is the fallback.
      const pinFrom = (p: unknown): string | null => {
        const pin = (p as { material?: { subjectPin?: { assetId?: unknown } } } | null | undefined)
          ?.material?.subjectPin;
        return pin && typeof pin.assetId === "string" && pin.assetId ? pin.assetId : null;
      };
      let subjectAssetId = pinFrom(picked?.payload);
      if (!subjectAssetId) {
        const currentTakes = await db
          .select({ payload: stageTakesTable.payload })
          .from(stageTakesTable)
          .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.isCurrent, true)));
        subjectAssetId = currentTakes.map(t => pinFrom(t.payload)).find(Boolean) ?? null;
      }

      const referenceSlots = [] as Array<{ imageBuffer: Buffer; mimeType: string; slot: "character" | "object" | "style"; description: string }>;
      let subjectRefName: string | null = null;
      // Why the reference did NOT ride, when it did not — walked on the live
      // build 2026-08-11: the demo post's pin is an owner-blocked asset
      // (generation_allowed=false), the gate rightly refused it, and the take
      // then said nothing. Silence about refused material is the lie the rail
      // exists to prevent (§1.17), so the refusal is recorded by name.
      let subjectRefDropped: string | null = null;
      if (subjectAssetId) {
        const [subjectAsset] = await loadBrandAssetsByIds(creative.brandId, [subjectAssetId]);
        // The same gate every other reference passes; a subject blocked since
        // the pick must not keep steering through the pin's memory.
        const verdict = subjectAsset
          ? checkGenerationEligibility(
              subjectAsset,
              { channel: null, template: creative.templateId ?? null },
              "generation_reference",
            )
          : null;
        if (subjectAsset?.fileUrl && verdict?.eligible) {
          const buf = await readFileByUrl(subjectAsset.fileUrl);
          if (buf) {
            referenceSlots.push({
              imageBuffer: buf,
              mimeType: (subjectAsset.mimeType as string) || "image/png",
              slot: "character",
              description: slotDescriptionForAsset(subjectAsset, "character"),
            });
            subjectRefName = subjectAsset.name;
          } else {
            subjectRefDropped = `${subjectAsset.name}: the reference image could not be read`;
          }
        } else if (subjectAsset) {
          subjectRefDropped = `${subjectAsset.name}: ${verdict?.reason ?? "not eligible for generation"}`;
        }
      }

      /*
       * The brand's own mark rides as a reference image (strict marks, extended
       * to video). Tony's 2026-08-11 clip ADDED Nike swooshes and REDREW the
       * Crown U mark: the video model treats a mark in the frame as paintable
       * pixels unless it is handed the real file and told the rules. Same
       * findBestMarkAsset the correction paths use, ranked against the brand
       * name so it finds the primary mark.
       */
      let autoAttachedMark: string | null = null;
      if (brand) {
        const mark = await findBestMarkAsset({
          brandId: creative.brandId,
          text: `${brand.name} logo primary mark`,
          template: creative.templateId ?? null,
        });
        const markBuf = mark?.fileUrl ? await readFileByUrl(mark.fileUrl) : null;
        if (mark && markBuf) {
          referenceSlots.push({
            imageBuffer: markBuf,
            mimeType: (mark.mimeType as string) || "image/png",
            slot: "object",
            description: `${slotDescriptionForAsset(mark, "object")} This is the brand's real mark: wherever a mark appears in the clip, it is THIS one, kept faithful in every frame.`,
          });
          autoAttachedMark = mark.name;
        }
      }

      const motionLock =
        "IDENTITY AND STYLE LOCK. This overrides everything below it. " +
        "The attached source frame IS the picture being animated: its character, art style and rendering are final. " +
        "The character's stylized game design — face, proportions, outfit, colours, and the way they are drawn — must remain EXACTLY as in the source frame in every frame of the clip. " +
        "No realism shift, no redesign, no restyling, no morphing toward photorealism. " +
        "Animate only pose, camera movement, lighting and the environment.";
      /*
       * Marks, said separately from identity, because the video model failed
       * them separately: it added third-party swooshes and redrew the brand
       * mark while the character held. The rule is the image path's
       * constraintTrailer translated to frames.
       */
      const motionMarks =
        "MARKS. The only marks permitted in the clip are the ones already visible in the source frame, kept pixel-faithful to the attached brand mark reference in every frame. " +
        "Never add, invent, redraw, restyle or substitute any logo, wordmark, swoosh or watermark. " +
        "No third-party or sponsor marks of any kind, in any frame, on any surface — clothing, equipment, signage or background.";
      /*
       * How these characters MOVE — Tony's decree from watching the first
       * locked clip (2026-08-11): "extremely fast/snappy, with big poses in
       * between... NOT real human physics... much closer to Dragon Ball Z."
       * Standing style for the product's game characters; a typed instruction
       * refines within it rather than replacing it.
       */
      const motionStyle =
        "MOTION STYLE. These are stylized game characters, and they move like it: extremely fast, snappy movements that cut between big, exaggerated poses held for a beat — anime-fight pacing in the spirit of Dragon Ball Z. " +
        "Never realistic human physics, never soft motion-captured weight, never slow naturalistic drift of the character.";
      const baseInstruction = instruction?.trim() ||
        "Convert this image into a short, dynamic video clip: the character snaps between big poses with fast, punchy motion while the camera whips or cuts rather than drifts. Keep the brand framing intact.";
      const motionPrompt = [
        motionLock,
        motionMarks,
        motionStyle,
        baseInstruction,
        contract ? `NON-NEGOTIABLE BRAND CONSTRAINTS:\n${contract}` : "",
      ].filter(Boolean).join("\n\n");

      /*
       * When the chain replaced the seed, the beat's own picked still rides as a
       * reference instead: it is the composition somebody chose, and throwing it
       * away to gain continuity would trade one fidelity for another.
       */
      if (chainedFromClip) {
        referenceSlots.push({
          imageBuffer: stillBuffer,
          mimeType: "image/png",
          slot: "style",
          description:
            "This is the still chosen for this moment. The clip starts from the previous shot's final frame and "
            + "moves TOWARDS this composition: match its staging, framing and action.",
        });
      }

      /*
       * THE ROUTE. One decision, taken from what the shot declared rather than
       * from a menu: a pinned end frame needs a model that accepts one, and
       * Omni does not (probed — services/veo.ts). Everything else — the lock,
       * the marks rule, the style decree, the brand contract, the references —
       * is identical on both engines, because it is all in the prompt and the
       * attachments rather than in the vendor.
       */
      let engine: "omni" | "veo-3.1-fast" = endFrameBuffer ? "veo-3.1-fast" : "omni";
      let veoReferencesDropped = false;
      let routeFellBack: string | null = null;

      let videoResult: { videoBuffer: Buffer };
      let veoCostUsd: number | null = null;
      let veoDurationSeconds: number | null = null;

      if (endFrameBuffer) {
        try {
          const veo = await runVeoVideo({
            prompt: motionPrompt,
            firstFrame: { buffer: seedBuffer, mimeType: "image/png" },
            lastFrame: { buffer: endFrameBuffer, mimeType: "image/png" },
            references: referenceSlots.map(r => ({ buffer: r.imageBuffer, mimeType: r.mimeType })),
            durationSeconds: 6,
          });
          videoResult = { videoBuffer: veo.videoBuffer };
          veoCostUsd = veo.costUsd;
          veoDurationSeconds = veo.durationSeconds;
          veoReferencesDropped = veo.referencesDropped;
        } catch (veoErr) {
          /*
           * Routing FAILS OVER rather than failing. A pinned shot that cannot
           * be rendered by the pinning model is still a shot worth having, so
           * it falls back to Omni WITHOUT the pin and says exactly that — the
           * alternative is a person losing the whole animation to a preview
           * model's outage.
           */
          routeFellBack = veoErr instanceof Error ? veoErr.message : "the pinning model could not be reached";
          console.warn("Veo route failed; falling back to Omni without the end pin", veoErr);
          engine = "omni";
          endFrameBuffer = null;
          videoResult = await runVideoInteraction({
            prompt: motionPrompt,
            imageBuffer: seedBuffer,
            imageMimeType: "image/png",
            aspectRatio: "1:1",
            slots: referenceSlots,
          });
        }
      } else {
        videoResult = await runVideoInteraction({
          prompt: motionPrompt,
          imageBuffer: seedBuffer,
          imageMimeType: "image/png",
          aspectRatio: "1:1",
          slots: referenceSlots,
        });
      }

      const videoFilename = `studio-motion-${crypto.randomUUID()}.mp4`;
      await writeBuffer("generated", videoFilename, videoResult.videoBuffer);
      const videoUrl = `/api/files/generated/${videoFilename}`;
      /*
       * Veo states its own duration and bills at its own rate, so its clip is
       * not measured by the byte-length estimate Omni's is. Two engines, two
       * honest numbers, rather than one estimate stretched over both.
       */
      const durationSeconds = veoDurationSeconds
        ?? estimateVideoDurationSeconds(videoResult.videoBuffer.length);
      const costUsd = veoCostUsd ?? durationSeconds * COST_ESTIMATES.VIDEO_COST_PER_SECOND_USD;

      const payload = {
        videoUrl,
        sourceImageUrl: stillUrl,
        // Lineage for cut staleness: which still, in which slot, made this clip.
        sourceSlotKey: sourceSlot,
        sourceStillTakeId: picked?.id ?? null,
        instruction: instruction?.trim() || null,
        durationSeconds,
        ...(typeof beat === "number" ? { beat } : {}),
        // What THIS clip actually cost on THIS environment, so the panel's
        // price hint reads the real rate instead of a stale hardcode (the
        // old "≈$1.70" label came from $0.42/s rows and overstated 4x here).
        costUsd,
        material: {
          referenceCount: 1 + referenceSlots.length,
          subjectRef: subjectRefName,
          subjectRefDropped,
          autoAttachedMark,
          director: persona?.name ?? null,
          identityLock: true,
          /*
           * Which engine rendered this, and how it was seeded. The Material
           * rail's disclosure for routing-without-a-dropdown: today every clip
           * is Omni, and when end-frame pinning routes to Veo 3.1 this is the
           * field that will say so.
           */
          engine,
          chainedFromClip,
          chainRefused,
          /** Set when the shot was pinned to end on the next moment. */
          endPinned: engine === "veo-3.1-fast",
          endPinRefused,
          /** Set when the pinning model was asked for and could not deliver. */
          routeFellBack,
          /** Set when the pinning model would not take the identity references. */
          veoReferencesDropped,
        },
      };

      let clipTakeId: string | null = null;
      await db.transaction(async (tx) => {
        if (sequenceId) {
          /*
           * A shot for the sequence: its own clip_* slot, so the motion slot's
           * quick-path clip is untouched, then a studio_take clip row at the
           * end of the cut. The unique (sequenceId, position) index turns a
           * concurrent append into a constraint failure instead of two shots
           * silently claiming one slot.
           *
           * **RE-ANIMATING A BEAT REPLACES ITS SHOT, IT DOES NOT ADD ONE.**
           * Found by walking step 5: re-animating beat 2 appended, so the cut
           * held three clips for two animated beats and played the mid-race
           * moment twice — 9s of video for a 6s story, with one clip take
           * silently orphaned. A beat is ONE shot; two clips for it is not a
           * choice, it is a duplicate. So the beat's previous clip goes to
           * history (isCurrent=false, restorable like every other take) and its
           * row in the cut is RE-POINTED in place, keeping the position the
           * story gave it. Only beats replace: the Sequence tab's
           * animate-any-take still appends, because there the shot genuinely is
           * a new one and the panel says it lands at the end.
           */
          let replacedClipRowId: string | null = null;
          if (typeof beat === "number") {
            const priorClips = await tx
              .select({ id: stageTakesTable.id, payload: stageTakesTable.payload })
              .from(stageTakesTable)
              .where(and(
                eq(stageTakesTable.stageStateId, stageId),
                eq(stageTakesTable.isCurrent, true),
              ));
            const priorIds = priorClips
              .filter(t => {
                const pl = t.payload as { videoUrl?: unknown; beat?: unknown } | null;
                return typeof pl?.videoUrl === "string" && pl?.beat === beat;
              })
              .map(t => t.id);

            if (priorIds.length > 0) {
              await tx
                .update(stageTakesTable)
                .set({ isCurrent: false })
                .where(inArray(stageTakesTable.id, priorIds));

              // The rows in the cut those takes were playing. The first keeps
              // its slot; any others are duplicates from before this rule and
              // are removed rather than left to play the same beat twice.
              const rows = await tx
                .select({ id: sequenceClipsTable.id, position: sequenceClipsTable.position })
                .from(sequenceClipsTable)
                .where(and(
                  eq(sequenceClipsTable.sequenceId, sequenceId),
                  inArray(sequenceClipsTable.sourceTakeId, priorIds),
                ))
                .orderBy(asc(sequenceClipsTable.position));
              if (rows.length > 0) {
                replacedClipRowId = rows[0].id;
                for (const extra of rows.slice(1)) {
                  await tx.delete(sequenceClipsTable).where(eq(sequenceClipsTable.id, extra.id));
                }
              }
            }
          }

          const [take] = await tx.insert(stageTakesTable).values({
            stageStateId: stageId,
            slotKey: `clip_${crypto.randomUUID().slice(0, 8)}`,
            // Take indexes are 1-based (stage_takes_index_positive_check) —
            // walked into on the live build: 0 rolled the whole insert back
            // AFTER the video was paid for.
            takeIndex: 1,
            origin: "generated",
            payload,
            isCurrent: true,
            costCents: Math.round(costUsd * 100),
          }).returning({ id: stageTakesTable.id });
          clipTakeId = take?.id ?? null;

          if (replacedClipRowId) {
            // In place: the story decided where this moment sits, and a
            // re-animate is a better take of the same moment, not a new one.
            await tx.update(sequenceClipsTable).set({
              sourceTakeId: clipTakeId,
              trimStartMs: 0,
              trimEndMs: Math.max(1, Math.round(durationSeconds * 1000)),
              sourceMissingAt: null,
            }).where(eq(sequenceClipsTable.id, replacedClipRowId));

            /*
             * Compact, because removing a duplicate above can leave a hole and
             * position IS the ordering model — "position 3" has to mean the
             * same thing before and after.
             */
            const rest = await tx.select().from(sequenceClipsTable)
              .where(eq(sequenceClipsTable.sequenceId, sequenceId))
              .orderBy(asc(sequenceClipsTable.position));
            for (const [i, row] of rest.entries()) {
              if (row.position !== i) {
                await tx.update(sequenceClipsTable).set({ position: i })
                  .where(eq(sequenceClipsTable.id, row.id));
              }
            }
          } else {
            const [last] = await tx
              .select({ max: sql<number>`COALESCE(MAX(${sequenceClipsTable.position}), -1)` })
              .from(sequenceClipsTable)
              .where(eq(sequenceClipsTable.sequenceId, sequenceId));
            await tx.insert(sequenceClipsTable).values({
              sequenceId,
              position: (last?.max ?? -1) + 1,
              sourceKind: "studio_take",
              sourceTakeId: clipTakeId,
              trimStartMs: 0,
              trimEndMs: Math.max(1, Math.round(durationSeconds * 1000)),
              transitionIn: "cut",
            });
          }
        } else {
          await tx
            .update(stageTakesTable)
            .set({ isCurrent: false })
            .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.slotKey, "motion")));
          const prior = await tx
            .select({ slotKey: stageTakesTable.slotKey, takeIndex: stageTakesTable.takeIndex })
            .from(stageTakesTable)
            .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.slotKey, "motion")));
          await tx.insert(stageTakesTable).values({
            stageStateId: stageId,
            slotKey: "motion",
            takeIndex: nextTakeIndex(prior, "motion"),
            origin: "generated",
            payload,
            isCurrent: true,
            costCents: Math.round(costUsd * 100),
          });
        }

        if (reservationId) await tx.delete(costLogsTable).where(eq(costLogsTable.id, reservationId));
        await tx.insert(costLogsTable).values(buildCostRow({
          creativeId,
          brandId: creative.brandId,
          service: "gemini",
          operation: "convert_video",
          // The engine that was actually billed. Recording Omni for a Veo clip
          // would make the ledger disagree with the invoice.
          model: engine === "veo-3.1-fast" ? VEO_MODEL : COPILOT_MODELS.OMNI_VIDEO_MODEL,
          costUsd,
          costDerivedFromUsage: true,
        }));
      });
      reservationId = null;

      res.json({
        videoUrl,
        durationSeconds,
        costUsd,
        clipTakeId,
        /** Routing, disclosed in the response as well as on the take. */
        engine,
        endPinned: engine === "veo-3.1-fast",
        endPinRefused,
        routeFellBack,
      });
    } catch (err) {
      if (reservationId) {
        try { await db.delete(costLogsTable).where(eq(costLogsTable.id, reservationId)); } catch { /* best effort */ }
      }
      console.error("Motion convert failed", err);
      res.status(500).json({ error: "The clip could not be made. Nothing was charged." });
    }
  },
);

const RegionEditBody = z.object({
  slotKey: z.string().min(1).max(64),
  /** A drawn area. Omitted when `layerId` names one instead. */
  region: z.unknown().optional(),
  /**
   * A DETECTED LAYER to scope to, instead of a drawn area (increment 5c).
   *
   * The same endpoint rather than a new one, deliberately: everything below
   * here — the lock gate, the mentions eligibility gate, the strict-marks
   * rule, the budget reservation, the drift measurement and the take history —
   * is already right and already walked. A layer is a region that came with a
   * NAME, so it enters the path that already scopes an instruction to a region.
   */
  layerId: z.string().min(1).optional(),
  /**
   * Where the selected layer should end up, dragged on the image.
   *
   * Present only with `layerId`. A move is two jobs in one generative pass —
   * draw it in the new place, close the hole in the old one — so the instruction
   * is composed by the server and the typed text is an EXTRA rather than the
   * whole ask. Same size as the layer's own box by construction: the drag says
   * where, never how big.
   */
  moveTo: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }).optional(),
  /*
   * WORDS, when the action needs them. A restyle is nothing without them; a
   * MOVE needs none — the drag already said the whole ask.
   *
   * It was required, so the composer sent `"move the <layer name>"` for a
   * wordless move (doc 46 §7.1). That put words in the history deck the user
   * never typed, appended a redundant clause to a prompt where every word costs
   * fidelity, and — worse after the strict-marks fix above — smuggled a mark's
   * layer NAME back into the prompt through the one field that is passed
   * through verbatim.
   */
  instruction: z.string().max(1000).optional(),
  // Same shape and same gate as refine-edit: the region editor's composer
  // gained `@` too (doc 41 item 3), and a mention is a mention wherever typed.
  mentions: z
    .array(z.object({
      assetId: z.string().min(1),
      name: z.string().min(1),
      role: z.enum(["subject", "style", "object"]),
    }))
    .max(4)
    .optional(),
});

router.post(
  "/creatives/:creativeId/stages/:stageId/region-edit",
  requireStandardWrite,
  generationLimiter,
  validateRequest({ body: RegionEditBody }),
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const stageId = String(req.params.stageId);
    const { slotKey, region: rawRegion, layerId, moveTo, instruction, mentions = [] } = req.body as z.infer<typeof RegionEditBody>;
    /** What the user actually typed, which for a move may be nothing at all. */
    const said = (instruction ?? "").trim();
    let reservationId: string | null = null;

    try {
      if (!layerId && rawRegion === undefined) {
        res.status(400).json({ error: "Say where to change: draw an area or pick a layer. Nothing was charged." });
        return;
      }
      if (moveTo && !layerId) {
        res.status(400).json({ error: "Only a layer can be moved, and no layer was named. Nothing was charged." });
        return;
      }
      // A move is the one action the drag fully describes. Everything else needs
      // words, and an empty instruction would otherwise buy an image of nothing.
      if (!moveTo && said.length === 0) {
        res.status(400).json({ error: "Say what to change. Nothing was charged." });
        return;
      }

      /*
       * A named layer, when one was picked. Loaded BEFORE anything is reserved,
       * and joined back through the take so a layer id from another post cannot
       * scope an edit here.
       */
      let layer: {
        id: string;
        name: string;
        /** WHAT it is, not just what it is called — the marks rule reads this. */
        kind: LayerKind;
        /** The authoritative file, when attribution found one. */
        assetId: string | null;
        bbox: { x: number; y: number; w: number; h: number };
      } | null = null;
      if (layerId) {
        const [row] = await db
          .select({
            id: takeLayersTable.id,
            name: takeLayersTable.name,
            kind: takeLayersTable.kind,
            assetId: takeLayersTable.assetId,
            bbox: takeLayersTable.bbox,
          })
          .from(takeLayersTable)
          .innerJoin(stageTakesTable, eq(takeLayersTable.stageTakeId, stageTakesTable.id))
          .where(and(
            eq(takeLayersTable.id, layerId),
            eq(takeLayersTable.isCurrent, true),
            eq(stageTakesTable.stageStateId, stageId),
            eq(stageTakesTable.slotKey, slotKey),
            eq(stageTakesTable.isCurrent, true),
          ));
        if (!row) {
          res.status(404).json({
            error: "That layer is not part of this take any more, so nothing was changed or charged. Take the picture apart again.",
          });
          return;
        }
        layer = row;
      }

      /*
       * A MOVE is scoped to the union of where the layer is and where it is
       * going: both places change, so measuring drift against either one alone
       * would report the other half of the edit as damage.
       */
      const destination = moveTo && layer
        ? { x: moveTo.x, y: moveTo.y, w: layer.bbox.w, h: layer.bbox.h }
        : null;
      const scopeBox = layer
        ? (destination ? unionBox(layer.bbox, destination) : layer.bbox)
        : null;

      // Reject a bad region BEFORE reserving anything. A silently widened mask
      // would edit pixels nobody selected, and the drift report cannot undo that.
      const region = normalizeRegion(scopeBox ? { shape: "box", ...scopeBox } : rawRegion);
      if (!region) {
        res.status(400).json({
          error: layer
            ? "That layer's area could not be read, so nothing was changed or charged."
            : "That selection could not be read as an area, so nothing was changed or charged.",
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
        .select({ id: stageTakesTable.id, payload: stageTakesTable.payload, takeIndex: stageTakesTable.takeIndex })
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

      // The same gate the spread's and refine's mentions pass, refusals named
      // the same way (doc 41 item 3: the region editor's @ tags assets too).
      const mentionRows = await loadBrandAssetsByIds(creative.brandId, mentions.map(m => m.assetId));
      const mentionRowById = new Map(mentionRows.map(a => [a.id, a]));
      const droppedMentions: Array<{ name: string; reason: string }> = [];
      const allowed = mentions.filter((mn) => {
        const row = mentionRowById.get(mn.assetId);
        if (!row) {
          droppedMentions.push({ name: mn.name, reason: "No longer in this brand's library" });
          return false;
        }
        const verdict = checkGenerationEligibility(
          row,
          { channel: null, template: creative.templateId ?? null },
          mn.role === "object" ? "compositing" : "generation_reference",
        );
        if (!verdict.eligible) {
          droppedMentions.push({ name: mn.name, reason: verdict.reason ?? "Not eligible" });
          return false;
        }
        return true;
      });

      /*
       * STRICT MARKS ON THE LAYER PATH (doc 46 §1). Resolved BEFORE the budget
       * is reserved, because the answer can be a refusal.
       *
       * A mark layer's own `assetId` IS the authoritative artwork, and until now
       * this route dropped that column and named the mark in prose instead — so
       * the model copied it out of the before-image, a copy of a copy every
       * edit, with nothing to pull it back to the file. An `@`-mentioned object
       * reference satisfies the same requirement, so it counts.
       */
      let markLayerAsset: { id: string; name: string; mimeType: string | null } | null = null;
      let markLayerBuffer: Buffer | null = null;
      let markPromptName: string | null = null;
      if (layer?.kind === "mark") {
        if (layer.assetId) {
          const [row] = await db
            .select({
              id: assetsTable.id,
              name: assetsTable.name,
              fileUrl: assetsTable.fileUrl,
              mimeType: assetsTable.mimeType,
            })
            .from(assetsTable)
            .where(and(eq(assetsTable.id, layer.assetId), ne(assetsTable.status, "archived")));
          // Unreadable is the same as absent: a file that cannot be attached
          // must not license naming the mark in the prompt.
          const buf = row?.fileUrl ? await readFileByUrl(row.fileUrl) : null;
          if (row && buf) {
            markLayerAsset = { id: row.id, name: row.name, mimeType: row.mimeType };
            markLayerBuffer = buf;
          }
        }
        const mentionedMark = allowed
          .filter(mn => mn.role === "object")
          .map(mn => mentionRowById.get(mn.assetId))
          .find(row => Boolean(row?.fileUrl));
        const refusal = layerEditRefusal({
          name: layer.name,
          kind: layer.kind,
          hasMarkArtwork: Boolean(markLayerAsset) || Boolean(mentionedMark),
          // Typed words on a mark are an instruction to alter it, and a mark may
          // not be altered (Tony, 2026-08-23). A drag types nothing, which is
          // why `said` and not `instruction` is the test: whitespace is silence.
          hasInstruction: said.length > 0,
        });
        if (refusal) {
          res.status(422).json({ error: refusal });
          return;
        }
        // The only name the prompt may use. The mentioned file's own name when
        // that is what will be attached, so prose never falls back to the layer.
        markPromptName = markLayerAsset?.name ?? mentionedMark?.name ?? null;
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

      const slotFor = { subject: "character", object: "object", style: "style" } as const;
      const referenceSlots = [] as Array<{ imageBuffer: Buffer; mimeType: string; slot: "character" | "object" | "style"; description: string }>;
      for (const mn of allowed) {
        const row = mentionRowById.get(mn.assetId);
        const url = row?.fileUrl;
        if (typeof url !== "string") continue;
        const buf = await readFileByUrl(url);
        if (!buf) {
          droppedMentions.push({ name: mn.name, reason: "The reference image could not be read" });
          continue;
        }
        referenceSlots.push({
          imageBuffer: buf,
          mimeType: (row?.mimeType as string) || "image/png",
          slot: slotFor[mn.role],
          description: `${slotDescriptionForAsset(row!, slotFor[mn.role])} Attached by the user for this edit.`,
        });
      }

      // Strict marks, same as refine-edit: a typed "add the logo" correction
      // attaches the real mark instead of letting prose invent one.
      let autoAttachedMark: string | null = null;
      // The id as well as the name: the name is what the rail SHOWS, the id is
      // what makes the mark a cast member the layer list can resolve to a file.
      let autoAttachedMarkId: string | null = null;
      /*
       * The mark whose LAYER is being edited, resolved above. Attached first so
       * the `mentionsMark` fallback below sees an object slot already filled and
       * does not go looking for a second, worse-matched mark. Recorded as an
       * auto-attachment because that is exactly what it is — which also keeps
       * the layer panel's "The real mark file, attached to this render." true
       * across the edit, since the next take's cast reads these selections.
       */
      if (markLayerAsset && markLayerBuffer) {
        referenceSlots.push({
          imageBuffer: markLayerBuffer,
          mimeType: markLayerAsset.mimeType || "image/png",
          slot: "object",
          description: markLayerSlotDescription(markLayerAsset.name),
        });
        autoAttachedMark = markLayerAsset.name;
        autoAttachedMarkId = markLayerAsset.id;
      }
      if (mentionsMark(said) && !referenceSlots.some(s => s.slot === "object")) {
        const mark = await findBestMarkAsset({
          brandId: creative.brandId,
          text: said,
          template: creative.templateId ?? null,
        });
        const markBuf = mark?.fileUrl ? await readFileByUrl(mark.fileUrl) : null;
        if (mark && markBuf) {
          referenceSlots.push({
            imageBuffer: markBuf,
            mimeType: (mark.mimeType as string) || "image/png",
            slot: "object",
            description: `${slotDescriptionForAsset(mark, "object")} Attached automatically because the instruction names a mark.`,
          });
          autoAttachedMark = mark.name;
          autoAttachedMarkId = mark.id;
        }
      }

      /*
       * A NAME beats coordinates. The Interactions API masks semantically, so
       * the geometry has to become words either way — and "the Crown U Mark, a
       * small area in the upper left" tells the model which thing to change,
       * where a rectangle only tells it where to look.
       *
       * For a MARK the name is not the layer's, it is the attached file's, per
       * the rule at `creative-direction.ts:679`: prose may say "the brand mark
       * in <asset name>" and nothing more.
       */
      const layerRef = layer
        ? layerPromptReference({ name: layer.name, kind: layer.kind, markAssetName: markPromptName })
        : "";
      const scoped = layer && destination
        ? layerMoveSentence(
            layerRef,
            describeRegion({ shape: "box", ...layer.bbox }),
            describeRegion({ shape: "box", ...destination }),
            said,
          )
        : layer
          ? layerScopeSentence(layerRef, describeRegion(region), said)
          : `Change only ${describeRegion(region)}. ${said} Leave the rest of the image exactly as it is.`;
      const prompt = wrapEditInstruction(contract, scoped);

      const result = await runImageInteraction({
        prompt,
        slots: [
          { imageBuffer: beforeBuffer, mimeType: "image/png", slot: "object", description: "The image being edited." },
          ...referenceSlots,
        ],
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
        const [inserted] = await tx.insert(stageTakesTable).values({
          stageStateId: stageId,
          slotKey,
          takeIndex: nextTakeIndex(prior, slotKey),
          origin: "region_edit",
          payload: {
            imageUrl: afterUrl,
            sourceImageUrl: beforeUrl,
            // Which take, not just which picture — same reason as refine-edit:
            // the layer read model walks this to carry the cast across an edit.
            sourceTakeId: current?.id ?? null,
            // Null rather than invented: a wordless move typed nothing, so the
            // deck reads the move off `movedTo` instead of quoting words.
            instruction: said || null,
            region,
            /*
             * Which layer this was scoped to, by id AND by name. The id can go
             * stale — a re-detect supersedes the set — so the name is kept
             * alongside it, or the deck's transcript would lose the ability to
             * say what an old edit was aimed at.
             */
            layerId: layer?.id ?? null,
            layerName: layer?.name ?? null,
            /** Where it was asked to go, so the deck can say a move happened. */
            movedTo: destination,
            drift,
            mentions: allowed,
            droppedMentions,
            material: {
              referenceCount: 1 + referenceSlots.length,
              director: persona?.name ?? null,
              autoAttachedMark,
              // What THIS edit attached, so it reads as this take's own cast
              // rather than as something inherited from before it.
              directorSelections: [
                ...allowed.map(mn => ({ role: mn.role, assetId: mn.assetId })),
                ...(autoAttachedMarkId ? [{ role: "object" as const, assetId: autoAttachedMarkId }] : []),
              ],
            },
          },
          isCurrent: true,
          costCents: Math.round(estimateImagenCost(1) * 100),
        }).returning({ id: stageTakesTable.id });

        /*
         * THE DECOMPOSITION SURVIVES A CLEAN LAYER EDIT.
         *
         * `take_layers` hangs off a take, so without this a layer edit silently
         * threw the decomposition away and the panel went back to NOT LOCATED —
         * changing two layers would have meant paying for detection twice, the
         * second time to re-learn something nothing had invalidated. The drift
         * report is the evidence: clean means measured proof that nothing
         * outside the edited layer's own area moved, so every other box is
         * still as true as it was. See shouldCarryLayers for the cases where that
         * claim cannot be made.
         *
         * `true` because every edit on THIS route is scoped — a named layer or a
         * hand-drawn area, and it refuses above if it has neither. It used to
         * pass `layer !== null`, which silently threw the decomposition away on a
         * clean box edit for no stated reason (doc 46 §6).
         */
        if (
          inserted && current?.id &&
          shouldCarryLayers(true, drift?.driftPercent ?? null, DRIFT_TOLERANCE, destination !== null)
        ) {
          const carried = await tx
            .select()
            .from(takeLayersTable)
            .where(and(eq(takeLayersTable.stageTakeId, current.id), eq(takeLayersTable.isCurrent, true)));
          if (carried.length > 0) {
            await tx.insert(takeLayersTable).values(carried.map(l => ({
              stageTakeId: inserted.id,
              layerIndex: l.layerIndex,
              name: l.name,
              kind: l.kind,
              origin: l.origin,
              assetId: l.assetId,
              bbox: l.bbox,
              isCurrent: true,
            })));
          }
        }

        if (reservationId) await tx.delete(costLogsTable).where(eq(costLogsTable.id, reservationId));
        await tx.insert(costLogsTable).values(buildCostRow({
          creativeId,
          brandId: creative.brandId,
          service: "gemini",
          operation: destination ? "layer_move" : layer ? "layer_edit" : "region_edit",
          model: AI_MODELS.GEMINI_FLASH_IMAGE,
          costUsd: estimateImagenCost(1),
        }));
      });
      reservationId = null;

      res.json({
        imageUrl: afterUrl,
        droppedMentions,
        layerName: layer?.name ?? null,
        moved: destination !== null,
        /*
         * Said out loud, because a move INVENTS the pixels it leaves behind and
         * a caller that treated this like a recolour would be trusting a
         * reconstruction it never asked about.
         */
        moveCaveat: destination
          ? "What was behind it had to be invented, and the layers are stale until you take the picture apart again."
          : null,
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
