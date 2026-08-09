/**
 * Phase 9 · the sequence, its clips, and the read model the timeline draws from.
 *
 * Two design answers live here rather than in the client, so the screen cannot
 * disagree with the render:
 *
 * **Adding a clip.** Three source kinds, one behaviour. `clip-candidates`
 * returns all three in one shape and, for the library, applies the SAME policy
 * the rest of the app applies and reports HOW MANY it hid and why. A picker
 * that silently showed fewer assets would look like a thin library rather than
 * a working guard.
 *
 * **A track that is still generating.** `GET /sequences/:id` returns the mixer's
 * own warnings alongside the tracks, which is how the timeline can say "the
 * music cannot duck yet, render the voice first" in the mixer's words instead of
 * inventing its own. That warning has existed in the code since the mixer landed
 * and had nowhere to appear.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  assetsTable,
  audioTracksTable,
  creativeVariantsTable,
  creativesTable,
  sequenceClipsTable,
  sequencesTable,
  type Asset,
} from "@workspace/db";
import { str } from "../lib/http-params.js";
import { requireStandardWrite } from "../middleware/auth.js";
import { checkGenerationEligibility } from "../services/asset-policy.js";
import { buildSequencePlan, type PlanClip } from "../services/sequence-plan.js";
import { buildMixPlan, type MixTrack } from "../services/mixer.js";

const router: IRouter = Router();

/** Generated clips are a fixed 6s, so a take contributes exactly that. */
const GENERATED_CLIP_MS = 6000;

/**
 * The violated constraint's name, dug out of the driver error.
 *
 * Postgres reports it as `constraint` on the error object. Drizzle wraps that
 * and its own `message` is the failed SQL with the bound parameters, so
 * matching the message both fails to identify the constraint AND risks putting
 * the query in a response body.
 */
function constraintOf(err: unknown): string | null {
  let cursor: unknown = err;
  for (let depth = 0; depth < 4 && cursor; depth += 1) {
    const name = (cursor as { constraint?: unknown }).constraint;
    if (typeof name === "string") return name;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return null;
}

// ── the read model the timeline draws ───────────────────────────────────────

router.get("/sequences/:id", async (req: Request, res: Response): Promise<void> => {
  const id = str(req.params.id);
  const [sequence] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, id));
  if (!sequence) {
    res.status(404).json({ error: "Sequence not found" });
    return;
  }

  const clips = await db.select().from(sequenceClipsTable)
    .where(eq(sequenceClipsTable.sequenceId, id))
    .orderBy(asc(sequenceClipsTable.position));

  const tracks = await db.select().from(audioTracksTable)
    .where(eq(audioTracksTable.sequenceId, id));

  const plan = buildSequencePlan(clips as unknown as PlanClip[]);
  const mix = buildMixPlan(tracks.map(t => ({
    id: t.id,
    trackKind: t.trackKind,
    startMs: t.startMs,
    durationMs: t.durationMs,
    gainDb: t.gainDb,
    duckUnder: t.duckUnder,
    duckAmountDb: t.duckAmountDb,
  }) as MixTrack));

  res.json({
    sequence,
    clips: plan.clips,
    tracks: tracks.map(t => ({
      ...t,
      /*
       * The duck windows come from the PLAN, not from the row, because a duck
       * is a consequence of the other tracks rather than a property of this
       * one. This is what the timeline shades, and it is computable before
       * anything renders precisely because the duck is scheduled.
       */
      duckWindows: mix.tracks.find(p => p.id === t.id)?.duckWindows ?? [],
      /** Null duration is the "still generating" case the UI draws dashed. */
      pending: t.durationMs === null,
    })),
    totalDurationMs: plan.totalDurationMs,
    /** Both layers' refusals, in their own words. */
    warnings: [...plan.warnings, ...mix.warnings],
  });
});

router.post(
  "/creatives/:creativeId/sequences",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = str(req.params.creativeId);
    const [creative] = await db.select().from(creativesTable).where(eq(creativesTable.id, creativeId));
    if (!creative) {
      res.status(404).json({ error: "Creative not found" });
      return;
    }
    const [created] = await db.insert(sequencesTable).values({ creativeId }).returning();
    res.status(201).json({ sequence: created });
  },
);

// ── adding a clip ───────────────────────────────────────────────────────────

export interface ClipCandidate {
  sourceKind: "generated" | "library_asset";
  id: string;
  name: string;
  durationMs: number | null;
  thumbnailUrl: string | null;
}

/**
 * What this creative could add, from every source that has anything.
 *
 * The library half is policy-filtered and REPORTS ITS FILTERING. `hidden`
 * carries a count and the reasons, so the picker can say "3 hidden: 2 carry a
 * mark, 1 awaiting review" rather than quietly being short.
 */
router.get("/creatives/:creativeId/clip-candidates", async (req: Request, res: Response): Promise<void> => {
  const creativeId = str(req.params.creativeId);
  const [creative] = await db.select().from(creativesTable).where(eq(creativesTable.id, creativeId));
  if (!creative) {
    res.status(404).json({ error: "Creative not found" });
    return;
  }

  // From this session: motion variants already made for this creative.
  const variants = await db.select().from(creativeVariantsTable)
    .where(and(
      eq(creativeVariantsTable.creativeId, creativeId),
      sql`${creativeVariantsTable.videoUrl} IS NOT NULL`,
    ));

  const generated: ClipCandidate[] = variants.map(v => ({
    sourceKind: "generated",
    id: v.id,
    name: v.platform ? `${v.platform} take` : "Take",
    durationMs: GENERATED_CLIP_MS,
    thumbnailUrl: v.compositedImageUrl ?? v.rawImageUrl ?? null,
  }));

  // From the library: video assets for this brand, gated by the real policy.
  const assets = await db.select().from(assetsTable)
    .where(and(
      eq(assetsTable.brandId, creative.brandId),
      sql`${assetsTable.mimeType} LIKE 'video/%'`,
    ));

  const libraryAssets: ClipCandidate[] = [];
  const hiddenReasons: Record<string, number> = {};
  for (const asset of assets) {
    const verdict = checkGenerationEligibility(asset as unknown as Asset, {
      channel: null,
      template: creative.templateId ?? null,
    });
    if (!verdict.eligible) {
      hiddenReasons[verdict.reason] = (hiddenReasons[verdict.reason] ?? 0) + 1;
      continue;
    }
    libraryAssets.push({
      sourceKind: "library_asset",
      id: asset.id,
      name: asset.name,
      // Unknown until probed. Null rather than a guess: the sequence's total
      // would otherwise be confidently wrong.
      durationMs: null,
      thumbnailUrl: asset.thumbnailUrl ?? null,
    });
  }

  res.json({
    generated,
    library: libraryAssets,
    hidden: {
      count: Object.values(hiddenReasons).reduce((a, b) => a + b, 0),
      reasons: Object.entries(hiddenReasons).map(([reason, count]) => ({ reason, count })),
    },
    /**
     * The one real capability difference between the sources, surfaced at the
     * moment of choosing rather than in a help page: generated clips cannot
     * show people, uploaded footage can.
     */
    uploadNote: "Uploaded footage may show people. Generated clips may not.",
  });
});

router.post(
  "/sequences/:id/clips",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const body = req.body as {
      sourceKind?: string;
      sourceVariantId?: string;
      sourceAssetId?: string;
      uploadUrl?: string;
      trimStartMs?: number;
      trimEndMs?: number;
      transitionIn?: string;
    };

    const [sequence] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, id));
    if (!sequence) {
      res.status(404).json({ error: "Sequence not found" });
      return;
    }

    const trimStartMs = typeof body.trimStartMs === "number" ? body.trimStartMs : 0;
    const trimEndMs = typeof body.trimEndMs === "number" ? body.trimEndMs : GENERATED_CLIP_MS;
    if (trimEndMs <= trimStartMs) {
      res.status(400).json({ error: "A clip has to end after it starts." });
      return;
    }

    /*
     * Append at the end. Read-max-then-write is a race, and the unique index on
     * (sequenceId, position) turns that race into a constraint violation rather
     * than two clips silently claiming one slot — so a 409 here is the honest
     * answer and the caller can retry.
     */
    const [last] = await db
      .select({ max: sql<number>`COALESCE(MAX(${sequenceClipsTable.position}), -1)` })
      .from(sequenceClipsTable)
      .where(eq(sequenceClipsTable.sequenceId, id));
    const position = (last?.max ?? -1) + 1;

    try {
      const [created] = await db.insert(sequenceClipsTable).values({
        sequenceId: id,
        position,
        sourceKind: body.sourceKind as "generated" | "library_asset" | "upload",
        sourceVariantId: body.sourceVariantId ?? null,
        sourceAssetId: body.sourceAssetId ?? null,
        uploadUrl: body.uploadUrl ?? null,
        trimStartMs,
        trimEndMs,
        transitionIn: (body.transitionIn as "cut" | "dissolve") ?? "cut",
      }).returning();
      res.status(201).json({ clip: created });
    } catch (err) {
      /*
       * The constraint name is on the DRIVER's error, not in the message
       * drizzle throws: that message is the failed SQL plus its parameters.
       * Matching on it therefore never fired, and the client got a 500 with the
       * whole query in the body. Caught by walking this endpoint rather than by
       * reading it, which is the only reason it is not still true.
       */
      const constraint = constraintOf(err);
      if (constraint === "sequence_clips_position_uq") {
        res.status(409).json({ error: "Another clip was added at the same moment. Try again." });
        return;
      }
      if (constraint === "sequence_clips_source_present_check") {
        res.status(400).json({
          error: "That clip does not point at anything. A generated clip needs a take, a library "
            + "clip needs an asset, and an upload needs a file.",
        });
        return;
      }
      if (constraint === "sequence_clips_trim_order_check") {
        res.status(400).json({ error: "A clip has to end after it starts." });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/sequences/:id/clips/:clipId",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const clipId = str(req.params.clipId);

    await db.transaction(async (tx) => {
      const [clip] = await tx.select().from(sequenceClipsTable)
        .where(and(eq(sequenceClipsTable.id, clipId), eq(sequenceClipsTable.sequenceId, id)));
      if (!clip) return;

      await tx.delete(sequenceClipsTable).where(eq(sequenceClipsTable.id, clipId));

      /*
       * Close the gap. Positions are the ordering model, so leaving a hole
       * would make "position 3" mean different things before and after a
       * delete. Done inside the transaction so a failure cannot leave the
       * sequence half-renumbered.
       */
      const rest = await tx.select().from(sequenceClipsTable)
        .where(eq(sequenceClipsTable.sequenceId, id))
        .orderBy(asc(sequenceClipsTable.position));
      for (const [i, row] of rest.entries()) {
        if (row.position !== i) {
          await tx.update(sequenceClipsTable).set({ position: i })
            .where(eq(sequenceClipsTable.id, row.id));
        }
      }
    });

    res.json({ ok: true });
  },
);

// ── audio tracks ────────────────────────────────────────────────────────────

router.post(
  "/sequences/:id/tracks",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const body = req.body as Record<string, unknown>;
    const [sequence] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, id));
    if (!sequence) {
      res.status(404).json({ error: "Sequence not found" });
      return;
    }
    const [created] = await db.insert(audioTracksTable).values({
      sequenceId: id,
      trackKind: body.trackKind as "voice" | "music" | "sfx" | "native",
      source: body.source as "elevenlabs_tts" | "elevenlabs_music" | "elevenlabs_sfx" | "veo_native" | "upload",
      audioUrl: (body.audioUrl as string) ?? null,
      startMs: typeof body.startMs === "number" ? body.startMs : 0,
      /** Null on purpose while a track is still being generated. */
      durationMs: typeof body.durationMs === "number" ? body.durationMs : null,
      gainDb: typeof body.gainDb === "number" ? body.gainDb : 0,
      duckUnder: (body.duckUnder as "voice" | "music" | "sfx" | "native") ?? null,
      duckAmountDb: typeof body.duckAmountDb === "number" ? body.duckAmountDb : -12,
    }).returning();
    res.status(201).json({ track: created });
  },
);

router.patch(
  "/sequences/:id/tracks/:trackId",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const trackId = str(req.params.trackId);
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.gainDb === "number") patch.gainDb = body.gainDb;
    if (typeof body.startMs === "number") patch.startMs = body.startMs;
    if (typeof body.durationMs === "number") patch.durationMs = body.durationMs;
    if (typeof body.duckAmountDb === "number") patch.duckAmountDb = body.duckAmountDb;
    if (body.duckUnder === null || typeof body.duckUnder === "string") patch.duckUnder = body.duckUnder;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Nothing to change." });
      return;
    }
    const [updated] = await db.update(audioTracksTable).set(patch)
      .where(eq(audioTracksTable.id, trackId)).returning();
    if (!updated) {
      res.status(404).json({ error: "Track not found" });
      return;
    }
    res.json({ track: updated });
  },
);

export default router;

/** Exported for the tests that check position compaction without HTTP. */
export async function clipIdsInOrder(sequenceId: string): Promise<string[]> {
  const rows = await db.select({ id: sequenceClipsTable.id })
    .from(sequenceClipsTable)
    .where(inArray(sequenceClipsTable.sequenceId, [sequenceId]))
    .orderBy(asc(sequenceClipsTable.position));
  return rows.map(r => r.id);
}
