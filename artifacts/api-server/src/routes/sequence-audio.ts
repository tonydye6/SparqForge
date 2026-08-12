/**
 * Sequencing build step 2 · sound generated INTO tracks.
 *
 * Phase 9 wrote generateSpeech and listVoices and gave them no routes; music
 * and SFX reached only the legacy single-video path. These are the doorways:
 * the brand's narrator reads the post's own copy into a voice track, a bed is
 * scored from the brand's sound direction at the cut's exact length, and SFX
 * land where they are told. Every generation is budget-gated and metered by
 * what it actually used (characters, seconds) — the flat $0.15 estimate was
 * the same stale-price class the motion label had.
 *
 * Ducking stays data: a music track is born with duckUnder="voice", so the
 * moment a voice track exists the timeline can draw the ducked span before
 * anything renders.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  audioTracksTable,
  brandsTable,
  costLogsTable,
  creativesTable,
  sequenceClipsTable,
  sequencesTable,
  stageStatesTable,
  stageTakesTable,
} from "@workspace/db";
import { z } from "zod";
import { str } from "../lib/http-params.js";
import { requireStandardWrite } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate.js";
import { reserveBudget, budgetExceededBody } from "../lib/budget.js";
import { buildCostRow } from "../services/cost-recording.js";
import { writeBuffer } from "../services/storage.js";
import {
  generateMusic,
  generateSFX,
  generateSpeech,
  listVoices,
  estimateTtsCost,
  estimateMusicCost,
  estimateSfxCost,
  estimateMp3DurationSeconds,
} from "../services/elevenlabs.js";
import { buildSequencePlan, type PlanClip } from "../services/sequence-plan.js";

const router: IRouter = Router();

/** The account's voices, for the brand record's narrator picker. */
router.get("/voices", async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ voices: await listVoices() });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "The voice list could not be read.",
    });
  }
});

/** Sequence → creative → brand, or a named refusal. */
async function loadSequenceContext(sequenceId: string) {
  const [sequence] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, sequenceId));
  if (!sequence) return null;
  const [creative] = await db.select().from(creativesTable).where(eq(creativesTable.id, sequence.creativeId));
  if (!creative) return null;
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, creative.brandId));
  return { sequence, creative, brand: brand ?? null };
}

const VoiceBody = z.object({
  /** Where the words come from: the post's own copy, or typed here. */
  source: z.enum(["hook", "base", "custom"]),
  script: z.string().max(2000).optional(),
});

router.post(
  "/sequences/:id/voice",
  requireStandardWrite,
  validateRequest({ body: VoiceBody }),
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const { source, script } = req.body as z.infer<typeof VoiceBody>;
    let reservationId: string | null = null;

    try {
      const ctx = await loadSequenceContext(id);
      if (!ctx) {
        res.status(404).json({ error: "Sequence not found" });
        return;
      }
      const voiceId = ctx.brand?.narratorVoiceId ?? null;
      if (!voiceId) {
        // The brand contract covers sound (doc 24 §3): no narrator means
        // "choose one", never "borrow a stranger's voice".
        res.status(400).json({
          error: "This brand has no narrator. Choose one first — the voice is part of the brand contract.",
        });
        return;
      }

      /*
       * The words. "hook"/"base" read the post's OWN copy take, so the voice
       * says what the post says, and the track remembers which take it spoke
       * (scriptTakeId) so a re-record can find its words after a rewrite.
       */
      let text = (script ?? "").trim();
      let scriptTakeId: string | null = null;
      if (source !== "custom") {
        const [copyTake] = await db
          .select({ id: stageTakesTable.id, payload: stageTakesTable.payload })
          .from(stageTakesTable)
          .innerJoin(stageStatesTable, eq(stageTakesTable.stageStateId, stageStatesTable.id))
          .where(and(
            eq(stageStatesTable.creativeId, ctx.creative.id),
            eq(stageStatesTable.stageKind, "copy"),
            eq(stageTakesTable.slotKey, "copy"),
            eq(stageTakesTable.isCurrent, true),
          ));
        const p = copyTake?.payload as { hook?: unknown; base?: unknown } | undefined;
        const fromCopy = source === "hook" ? p?.hook : p?.base;
        if (typeof fromCopy !== "string" || !fromCopy.trim()) {
          res.status(400).json({
            error: `The post has no ${source === "hook" ? "hook" : "caption"} to read yet. Write the copy first, or type a script.`,
          });
          return;
        }
        text = fromCopy.trim();
        scriptTakeId = copyTake?.id ?? null;
      }
      if (!text) {
        res.status(400).json({ error: "There is no script to speak." });
        return;
      }

      const costUsd = estimateTtsCost(text.length);
      const budget = await reserveBudget(ctx.creative.id, costUsd);
      if (!budget.ok) {
        res.status(429).json(budgetExceededBody(budget.todaySpend, budget.threshold));
        return;
      }
      reservationId = budget.reservationId;

      const speech = await generateSpeech({ script: text, voiceId });
      const filename = `sequence-voice-${crypto.randomUUID()}.mp3`;
      await writeBuffer("generated", filename, speech.audioBuffer);
      const durationMs = Math.round(estimateMp3DurationSeconds(speech.audioBuffer.length) * 1000);

      let track: typeof audioTracksTable.$inferSelect | undefined;
      await db.transaction(async (tx) => {
        [track] = await tx.insert(audioTracksTable).values({
          sequenceId: id,
          trackKind: "voice",
          source: "elevenlabs_tts",
          audioUrl: `/api/files/generated/${filename}`,
          startMs: 0,
          durationMs,
          gainDb: 0,
          scriptTakeId,
        }).returning();
        if (reservationId) await tx.delete(costLogsTable).where(eq(costLogsTable.id, reservationId));
        await tx.insert(costLogsTable).values(buildCostRow({
          creativeId: ctx.creative.id,
          brandId: ctx.creative.brandId,
          service: "elevenlabs",
          operation: "narrator_voiceover",
          model: "eleven_multilingual_v2",
          costUsd,
        }));
      });
      reservationId = null;

      res.status(201).json({ track, costUsd, characters: text.length });
    } catch (err) {
      if (reservationId) {
        try { await db.delete(costLogsTable).where(eq(costLogsTable.id, reservationId)); } catch { /* best effort */ }
      }
      console.error("Voice track failed", err);
      res.status(500).json({
        error: err instanceof Error && /narrator|API key|voice/i.test(err.message)
          ? err.message
          : "The voice could not be generated. Nothing was charged.",
      });
    }
  },
);

const MusicBody = z.object({
  prompt: z.string().max(600).optional(),
});

router.post(
  "/sequences/:id/music",
  requireStandardWrite,
  validateRequest({ body: MusicBody }),
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const { prompt } = req.body as z.infer<typeof MusicBody>;
    let reservationId: string | null = null;

    try {
      const ctx = await loadSequenceContext(id);
      if (!ctx) {
        res.status(404).json({ error: "Sequence not found" });
        return;
      }

      // The bed is scored at the CUT'S length, which is the whole point of
      // scoring it here instead of picking a stock loop.
      const clips = await db.select().from(sequenceClipsTable)
        .where(eq(sequenceClipsTable.sequenceId, id));
      const plan = buildSequencePlan(clips as unknown as PlanClip[]);
      if (plan.totalDurationMs <= 0) {
        res.status(400).json({ error: "The cut has no shots yet, so there is no length to score." });
        return;
      }
      // ElevenLabs music takes seconds; clamp to a sane request.
      const seconds = Math.min(60, Math.max(3, Math.round(plan.totalDurationMs / 1000)));

      const direction = (prompt ?? "").trim() || (ctx.brand?.soundDirection ?? "").trim();
      if (!direction) {
        res.status(400).json({
          error: "Say what the music should be, or set the brand's sound direction — it is part of the brand contract.",
        });
        return;
      }

      const costUsd = estimateMusicCost(seconds);
      const budget = await reserveBudget(ctx.creative.id, costUsd);
      if (!budget.ok) {
        res.status(429).json(budgetExceededBody(budget.todaySpend, budget.threshold));
        return;
      }
      reservationId = budget.reservationId;

      const music = await generateMusic(direction, seconds);
      const filename = `sequence-music-${crypto.randomUUID()}.mp3`;
      await writeBuffer("generated", filename, music.audioBuffer);

      let track: typeof audioTracksTable.$inferSelect | undefined;
      await db.transaction(async (tx) => {
        [track] = await tx.insert(audioTracksTable).values({
          sequenceId: id,
          trackKind: "music",
          source: "elevenlabs_music",
          audioUrl: `/api/files/generated/${filename}`,
          startMs: 0,
          durationMs: seconds * 1000,
          gainDb: -3,
          // Born ducking: the voice wins the moment one exists, and the
          // timeline can draw the span before anything renders.
          duckUnder: "voice",
          duckAmountDb: -12,
        }).returning();
        if (reservationId) await tx.delete(costLogsTable).where(eq(costLogsTable.id, reservationId));
        await tx.insert(costLogsTable).values(buildCostRow({
          creativeId: ctx.creative.id,
          brandId: ctx.creative.brandId,
          service: "elevenlabs",
          operation: "music_generation",
          model: "elevenlabs_music",
          costUsd,
        }));
      });
      reservationId = null;

      res.status(201).json({ track, costUsd, seconds });
    } catch (err) {
      if (reservationId) {
        try { await db.delete(costLogsTable).where(eq(costLogsTable.id, reservationId)); } catch { /* best effort */ }
      }
      console.error("Music track failed", err);
      res.status(500).json({ error: "The music could not be generated. Nothing was charged." });
    }
  },
);

const SfxBody = z.object({
  prompt: z.string().min(1).max(300),
  /** Where the hit lands on the timeline. SFX are hits, not blocks. */
  atMs: z.number().int().min(0).optional(),
  durationSeconds: z.number().min(0.5).max(10).optional(),
});

router.post(
  "/sequences/:id/sfx",
  requireStandardWrite,
  validateRequest({ body: SfxBody }),
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const { prompt, atMs, durationSeconds } = req.body as z.infer<typeof SfxBody>;
    let reservationId: string | null = null;

    try {
      const ctx = await loadSequenceContext(id);
      if (!ctx) {
        res.status(404).json({ error: "Sequence not found" });
        return;
      }
      const seconds = Math.min(10, Math.max(0.5, durationSeconds ?? 3));

      const costUsd = estimateSfxCost();
      const budget = await reserveBudget(ctx.creative.id, costUsd);
      if (!budget.ok) {
        res.status(429).json(budgetExceededBody(budget.todaySpend, budget.threshold));
        return;
      }
      reservationId = budget.reservationId;

      const sfx = await generateSFX(prompt.trim(), seconds);
      const filename = `sequence-sfx-${crypto.randomUUID()}.mp3`;
      await writeBuffer("generated", filename, sfx.audioBuffer);

      let track: typeof audioTracksTable.$inferSelect | undefined;
      await db.transaction(async (tx) => {
        [track] = await tx.insert(audioTracksTable).values({
          sequenceId: id,
          trackKind: "sfx",
          source: "elevenlabs_sfx",
          audioUrl: `/api/files/generated/${filename}`,
          startMs: atMs ?? 0,
          durationMs: Math.round(seconds * 1000),
          gainDb: 0,
        }).returning();
        if (reservationId) await tx.delete(costLogsTable).where(eq(costLogsTable.id, reservationId));
        await tx.insert(costLogsTable).values(buildCostRow({
          creativeId: ctx.creative.id,
          brandId: ctx.creative.brandId,
          service: "elevenlabs",
          operation: "sfx_generation",
          model: "elevenlabs_sfx",
          costUsd,
        }));
      });
      reservationId = null;

      res.status(201).json({ track, costUsd });
    } catch (err) {
      if (reservationId) {
        try { await db.delete(costLogsTable).where(eq(costLogsTable.id, reservationId)); } catch { /* best effort */ }
      }
      console.error("SFX track failed", err);
      res.status(500).json({ error: "The effect could not be generated. Nothing was charged." });
    }
  },
);

export default router;
