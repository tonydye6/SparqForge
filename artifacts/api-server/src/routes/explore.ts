import { Router, type IRouter, type Request, type Response } from "express";
import { db, assetsTable, brandsTable, costLogsTable, creativesTable, designerPersonasTable, stageStatesTable, stageTakesTable, type DesignerPersona } from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { AI_MODELS, COST_ESTIMATES, estimateImagenCost, imagePass, type ImagePassType } from "../lib/ai-config.js";

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
const DEFAULT_SPREAD_PASS: ImagePassType = "preview";
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
  loadBrand,
  mergeReferenceSlots,
  wrapEditInstruction,
} from "../services/creative-direction.js";
import { mentionsDirectiveBlock, normalizeMentions, pinnedSubjectFrom, type BriefMention } from "../services/brief-mentions.js";
import {
  buildDirectedPrompt,
  leadingSubjectRun,
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
async function intentFromBrief(creativeId: string): Promise<{
  intent: Intent | null;
  briefStageId: string | null;
  briefText: string | null;
  briefTakeId: string | null;
  mentions: BriefMention[];
}> {
  const [brief] = await db
    .select({ id: stageStatesTable.id })
    .from(stageStatesTable)
    .where(and(eq(stageStatesTable.creativeId, creativeId), eq(stageStatesTable.stageKind, "brief")));
  if (!brief) return { intent: null, briefStageId: null, briefText: null, briefTakeId: null, mentions: [] };

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

  const payload = take?.payload as { intentId?: unknown; line?: unknown; derived?: unknown; mentions?: unknown } | null | undefined;
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
  return { intent: isIntent(raw) ? raw : null, briefStageId: brief.id, briefText, briefTakeId: take?.id ?? null, mentions };
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
    const plan = buildExplorePlan({ intent: effective, perImageUsd: usdPerImage });

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
        /** Soft: nothing here refuses the run. The daily gate is the hard one. */
        hard: false,
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
     * Which pass this spread renders at. Phase 7 item 2.
     *
     * The default is still `full`, and that is deliberate: flipping it to
     * `preview` is a claim that a spread of flash-lite images is good enough to
     * choose a winner from, and doc 30 §7's "verified" covers the PRICE only.
     * `scripts/probe-image-pass.ts` renders both tiers off the same references
     * so that claim can be settled by looking. Until it is, shipping the cheaper
     * default would be exactly the trap doc 24 §5 lists first — building on a
     * premise nobody checked.
     */
    const requestedPass = (req.body as { pass?: unknown } | undefined)?.pass;
    const pass: ImagePassType = requestedPass === "preview" ? "preview" : DEFAULT_SPREAD_PASS;
    const { model: passModel, usdPerImage: perImageUsd } = imagePass(pass);
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

      const { intent, briefStageId, briefText, briefTakeId, mentions } = await intentFromBrief(creativeId);
      const fullPlan = buildExplorePlan({ intent: intent ?? "awareness", perImageUsd });

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
      let subjectPinnedFrom: "mention" | "previous run" | null =
        mentions.some(m => m.role === "subject") ? "mention" : null;
      const effectiveMentions: BriefMention[] = [...mentions];

      if (!subjectPinnedFrom) {
        const priorTakes = await db
          .select({ payload: stageTakesTable.payload })
          .from(stageTakesTable)
          .where(and(eq(stageTakesTable.stageStateId, stage.id), eq(stageTakesTable.isCurrent, true)));
        const pinnedId = pinnedSubjectFrom(priorTakes, briefTakeId);
        if (pinnedId) {
          const [pinnedAsset] = await loadBrandAssetsByIds(creative.brandId, [pinnedId]);
          if (pinnedAsset) {
            effectiveMentions.push({ assetId: pinnedAsset.id, name: pinnedAsset.name, role: "subject" });
            subjectPinnedFrom = "previous run";
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
        await tx.insert(costLogsTable).values(buildCostRow({
          creativeId,
          brandId: creative.brandId,
          service: "gemini",
          operation: "region_edit",
          model: AI_MODELS.GEMINI_FLASH_IMAGE,
          costUsd: estimateImagenCost(1),
        }));
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
