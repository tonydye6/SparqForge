/**
 * The story path · step 4b · what the storyboard sheet draws.
 *
 * The spread turned 90 degrees: columns are BEATS, not compositions. This is the
 * free read behind that sheet — the shot list, each beat's takes, which beat is
 * locked by a pick, and what running one more beat would cost.
 *
 * **Why a read model rather than the client assembling it.** The sheet has to
 * answer "which beats are done" and "what does the next run cost" in the same
 * words the run endpoint would use, or somebody presses a button priced at one
 * number and is charged another. Stage 03's takes already carry everything; the
 * one thing only the server can say honestly is the price, because that depends
 * on the configured pass.
 *
 * Free: no model call, no writes.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, stageStatesTable, stageTakesTable } from "@workspace/db";
import { str } from "../lib/http-params.js";
import { imagePass, DEFAULT_SPREAD_PASS } from "../lib/ai-config.js";
import {
  TAKES_PER_BEAT,
  beatOfPickSlotKey,
  beatOfSlotKey,
  spreadCostCents,
} from "../services/explore-plan.js";

const router: IRouter = Router();

interface BeatTake {
  slotKey: string;
  /** "a" or "b" — which framing of the moment this is. */
  variant: string;
  imageUrl: string | null;
  takeIndex: number;
  /** How many takes this slot has held, so the deck can say there is history. */
  history: number;
  framing: string | null;
}

router.get("/creatives/:creativeId/storyboard", async (req: Request, res: Response): Promise<void> => {
  const creativeId = str(req.params.creativeId);

  const stages = await db
    .select({ id: stageStatesTable.id, stageKind: stageStatesTable.stageKind, status: stageStatesTable.status })
    .from(stageStatesTable)
    .where(eq(stageStatesTable.creativeId, creativeId));

  const briefStage = stages.find(s => s.stageKind === "brief");
  const imageStage = stages.find(s => s.stageKind === "asset");
  if (!briefStage || !imageStage) {
    res.status(404).json({ error: "That post does not have both a Spark and a Media stage yet." });
    return;
  }

  const [briefTake] = await db
    .select({ payload: stageTakesTable.payload })
    .from(stageTakesTable)
    .where(and(
      eq(stageTakesTable.stageStateId, briefStage.id),
      eq(stageTakesTable.slotKey, "brief"),
      eq(stageTakesTable.isCurrent, true),
    ));

  /*
   * Re-validated at the boundary, exactly as explore-run does it: the takes
   * route stores payload as z.unknown(), and beat slot keys are named off this
   * numbering, so it is rebuilt here rather than trusted.
   */
  const bp = briefTake?.payload as { shape?: unknown; shots?: unknown } | undefined;
  const rawShots = Array.isArray(bp?.shots) ? bp.shots : [];
  const shots = rawShots
    .map(sh => (sh as { text?: unknown })?.text)
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t, i) => ({ n: i + 1, text: t.trim() }));
  const shape = bp?.shape === "sequence" && shots.length >= 2 ? "sequence" : "single";

  const takes = await db
    .select({
      slotKey: stageTakesTable.slotKey,
      takeIndex: stageTakesTable.takeIndex,
      isCurrent: stageTakesTable.isCurrent,
      payload: stageTakesTable.payload,
    })
    .from(stageTakesTable)
    .where(eq(stageTakesTable.stageStateId, imageStage.id))
    .orderBy(asc(stageTakesTable.takeIndex));

  /** How many takes each slot has ever held — the deck's "there is history" signal. */
  const historyBySlot = new Map<string, number>();
  for (const t of takes) historyBySlot.set(t.slotKey, (historyBySlot.get(t.slotKey) ?? 0) + 1);

  const { usdPerImage } = imagePass(DEFAULT_SPREAD_PASS);
  const beatCostCents = spreadCostCents(usdPerImage, TAKES_PER_BEAT);

  const beats = shots.map(shot => {
    const beatTakes: BeatTake[] = takes
      .filter(t => t.isCurrent && beatOfSlotKey(t.slotKey) === shot.n)
      .map(t => {
        const p = t.payload as { imageUrl?: unknown; axisB?: { label?: unknown } } | null;
        return {
          slotKey: t.slotKey,
          variant: t.slotKey.split("__")[1] ?? "",
          imageUrl: typeof p?.imageUrl === "string" ? p.imageUrl : null,
          takeIndex: t.takeIndex,
          history: historyBySlot.get(t.slotKey) ?? 1,
          framing: typeof p?.axisB?.label === "string" ? p.axisB.label : null,
        };
      })
      .sort((a, b) => a.variant.localeCompare(b.variant));

    /*
     * The pick, which is what LOCKS a beat. A pointer take in the beat's own
     * slot, the same shape the spread's "selected" pointer has, so the second
     * pass and the history behave identically.
     */
    const pickRow = takes.find(t => t.isCurrent && beatOfPickSlotKey(t.slotKey) === shot.n);
    const pickPayload = pickRow?.payload as { slotKey?: unknown; imageUrl?: unknown } | undefined;
    const picked = typeof pickPayload?.slotKey === "string"
      ? {
          slotKey: pickPayload.slotKey,
          imageUrl: typeof pickPayload.imageUrl === "string" ? pickPayload.imageUrl : null,
        }
      : null;

    return {
      n: shot.n,
      text: shot.text,
      takes: beatTakes,
      picked,
      /** A picked beat is locked: no run touches it. */
      locked: picked !== null,
      /** True when this beat has never been run, so the sheet can say so. */
      empty: beatTakes.length === 0,
    };
  });

  const pickedCount = beats.filter(b => b.locked).length;
  const unrunCount = beats.filter(b => b.empty && !b.locked).length;
  const unpickedCount = beats.filter(b => !b.locked).length;

  res.json({
    shape,
    stageId: imageStage.id,
    stageStatus: imageStage.status,
    beats,
    takesPerBeat: TAKES_PER_BEAT,
    /** What ONE beat costs to run, at the pass this environment is configured for. */
    beatCostUsd: beatCostCents / 100,
    pickedCount,
    unpickedCount,
    unrunCount,
    /**
     * The sentence the sheet's footer shows. Assembled here so the count, the
     * price and the refusal cannot disagree with the run endpoint.
     */
    summary: shape !== "sequence"
      ? "This post is one picture, so it has no storyboard."
      : `${pickedCount} of ${beats.length} beats picked`,
  });
});

export default router;
