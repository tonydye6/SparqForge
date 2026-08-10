/**
 * GET /creatives/:creativeId/smart-bar — the event feed and the cards.
 *
 * Read-only and free. Everything that decides what to say lives in
 * services/smart-bar.ts, pure and with 25 assertions behind it; this loads
 * the rows the product already writes and hands them over. There is no model
 * call anywhere in v1, which is what lets the bar refresh on every stage save
 * without anyone watching a meter.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  creativesTable,
  stageStatesTable,
  stageTakesTable,
} from "@workspace/db";
import { str } from "../lib/http-params.js";
import { INTENTS, type Intent } from "../lib/intents.js";
import { deriveCards, deriveEvents, type BarInput, type BarTake } from "../services/smart-bar.js";

const router: IRouter = Router();

router.get("/creatives/:creativeId/smart-bar", async (req: Request, res: Response): Promise<void> => {
  const creativeId = str(req.params.creativeId);
  try {
    const [creative] = await db
      .select({ id: creativesTable.id })
      .from(creativesTable)
      .where(eq(creativesTable.id, creativeId));
    if (!creative) {
      res.status(404).json({ error: "That post no longer exists." });
      return;
    }

    const stages = await db
      .select()
      .from(stageStatesTable)
      .where(eq(stageStatesTable.creativeId, creativeId));
    const takeRows = stages.length
      ? await db
          .select()
          .from(stageTakesTable)
          .where(inArray(stageTakesTable.stageStateId, stages.map((s) => s.id)))
      : [];

    const kindById = new Map(stages.map((s) => [s.id, s.stageKind]));
    const takes: BarTake[] = takeRows.map((t) => ({
      stageKind: kindById.get(t.stageStateId) ?? "",
      slotKey: t.slotKey,
      origin: t.origin,
      isCurrent: t.isCurrent,
      createdAt: t.createdAt.toISOString(),
      payload: t.payload,
    }));

    // The goal, read from the SAME field the spread planner reads
    // (payload.intentId, per intentFromBrief). One source, so the bar and the
    // planner can never disagree about whether a goal was recorded.
    const brief = takes.find((t) => t.stageKind === "brief" && t.slotKey === "brief" && t.isCurrent);
    const rawIntent = (brief?.payload as { intentId?: unknown } | null)?.intentId;
    const intent: Intent | null =
      typeof rawIntent === "string" && (INTENTS as readonly string[]).includes(rawIntent)
        ? (rawIntent as Intent)
        : null;

    const direction = takes.find((t) => t.stageKind === "direction" && t.isCurrent);
    const directorName = String((direction?.payload as { name?: unknown })?.name ?? "") || null;

    const input: BarInput = {
      stages: stages.map((s) => ({ stageKind: s.stageKind, status: s.status, updatedAt: s.updatedAt.toISOString() })),
      takes,
      intent,
      spreadSize: 8,
      directorName,
    };

    res.json({ events: deriveEvents(input), cards: deriveCards(input) });
  } catch (err) {
    console.error("Failed to read the smart bar", err);
    res.status(500).json({ error: "The smart bar could not be read." });
  }
});

export default router;
