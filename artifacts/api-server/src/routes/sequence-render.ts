/**
 * Sequencing build step 3 · render the cut, and hand it to the ship carry.
 *
 * Everything this needs already existed and had never been run end to end:
 * `buildSequencePlan` emits the join graph, `buildMixPlan` emits the mix graph,
 * `renderMix` lays tracks onto a video. What was missing is the endpoint that
 * resolves each shot to actual bytes — including the `studio_take` kind, whose
 * video lives in a stage take's payload rather than on any variant or asset —
 * runs both graphs, and writes a row that is TRUE about the file it points at.
 *
 * **It costs nothing, and says so.** Every other priced action here calls a
 * vendor; this one runs ffmpeg on the machine already running. Inventing a
 * price for it would be the same class of lie as the flat $0.15 the TTS
 * estimate used to tell, so there is no reservation and no ledger row — the
 * button says free because it is.
 *
 * **The cut takes the motion slot's place.** A rendered cut is written as a
 * take in stage 03's `motion` slot, which is the one thing ship already reads
 * for a clip. Nothing in the publish path had to learn a new concept: the
 * publish chip flips, the spine's Media node gets its glyph, and every channel
 * version carries the cut exactly as a single clip has since doc 41 item 6.
 * The take records the whole cut in `cut` — its sequence, its shots and their
 * lineage — so what shipped can always be traced back to the rows.
 *
 * **Nothing re-renders itself.** The fingerprint (migration 0044) is stamped
 * here and compared on every read; an edit after a render says STALE and waits
 * to be told again.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  assetsTable,
  audioTracksTable,
  creativeVariantsTable,
  creativesTable,
  sequenceClipsTable,
  sequencesTable,
  stageStatesTable,
  stageTakesTable,
} from "@workspace/db";
import { str } from "../lib/http-params.js";
import { requireStandardWrite } from "../middleware/auth.js";
import { writeBuffer } from "../services/storage.js";
import { readFileByUrl } from "../services/reference-images.js";
import { nextTakeIndex } from "../services/stage-graph.js";
import { buildSequencePlan, type PlanClip, type PlannedClip } from "../services/sequence-plan.js";
import { renderMix, type MixInput } from "../services/audio-merge.js";
import { assembleCut, ffmpegAvailable, measureDurationMs, type ClipSource } from "../services/cut-render.js";
import { cutStatus, type CutClip, type CutTrack } from "../services/cut-status.js";

const router: IRouter = Router();

type ClipRow = typeof sequenceClipsTable.$inferSelect;
type TrackRow = typeof audioTracksTable.$inferSelect;

/**
 * Where a clip's video actually lives, per kind.
 *
 * `studio_take` is the one the render path had never met: Studio v2's clips are
 * stage takes whose payload carries the videoUrl, not variants. Doc 43 §4 flags
 * exactly this as the thing the render must learn.
 */
async function resolveClipVideoUrl(clip: ClipRow): Promise<string | null> {
  switch (clip.sourceKind) {
    case "studio_take": {
      if (!clip.sourceTakeId) return null;
      const [take] = await db
        .select({ payload: stageTakesTable.payload })
        .from(stageTakesTable)
        .where(eq(stageTakesTable.id, clip.sourceTakeId));
      const p = take?.payload as { videoUrl?: unknown } | undefined;
      return typeof p?.videoUrl === "string" ? p.videoUrl : null;
    }
    case "generated": {
      if (!clip.sourceVariantId) return null;
      const [variant] = await db
        .select({ videoUrl: creativeVariantsTable.videoUrl })
        .from(creativeVariantsTable)
        .where(eq(creativeVariantsTable.id, clip.sourceVariantId));
      return variant?.videoUrl ?? null;
    }
    case "library_asset": {
      if (!clip.sourceAssetId) return null;
      const [asset] = await db
        .select({ fileUrl: assetsTable.fileUrl })
        .from(assetsTable)
        .where(eq(assetsTable.id, clip.sourceAssetId));
      return asset?.fileUrl ?? null;
    }
    case "upload":
      return clip.uploadUrl ?? null;
    default:
      return null;
  }
}

/**
 * Render, in one request.
 *
 * Synchronous on purpose: a 6s cut is a few seconds of ffmpeg on this machine,
 * and a job queue would buy asynchrony at the cost of a second place where a
 * render's state lives. `renderStatus` still moves through `rendering` so a
 * second press cannot start a second render over the first one's output.
 */
router.post(
  "/sequences/:id/render",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    let claimed = false;

    try {
      const [sequence] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, id));
      if (!sequence) {
        res.status(404).json({ error: "Sequence not found" });
        return;
      }
      const [creative] = await db.select().from(creativesTable)
        .where(eq(creativesTable.id, sequence.creativeId));
      if (!creative) {
        res.status(404).json({ error: "That post no longer exists." });
        return;
      }

      const clipRows = await db.select().from(sequenceClipsTable)
        .where(eq(sequenceClipsTable.sequenceId, id))
        .orderBy(asc(sequenceClipsTable.position));
      const trackRows = await db.select().from(audioTracksTable)
        .where(eq(audioTracksTable.sequenceId, id));

      const plan = buildSequencePlan(clipRows as unknown as PlanClip[]);
      const status = cutStatus({
        renderStatus: sequence.renderStatus,
        renderedUrl: sequence.renderedUrl,
        renderFingerprint: sequence.renderFingerprint,
        clips: clipRows as unknown as CutClip[],
        tracks: trackRows as unknown as CutTrack[],
        renderable: plan.renderable,
        totalDurationMs: plan.totalDurationMs,
      });
      if (status.blocked) {
        res.status(status.state === "rendering" ? 409 : 400).json({ error: status.blocked });
        return;
      }

      /*
       * Asked before anything is promised. This is the premise the whole step
       * rests on, and it had been asserted in a comment rather than checked
       * (ffmpeg 6.1.2 is on the Replit container — verified 2026-08-12).
       */
      if (!(await ffmpegAvailable())) {
        res.status(503).json({
          error: "This machine has no ffmpeg, so the cut cannot be rendered here. Nothing was changed.",
        });
        return;
      }

      /*
       * Claim the render. The status guard above read a row; this WRITES the
       * claim, so two presses a moment apart cannot both proceed to spend
       * minutes producing two files, one of which wins silently.
       */
      const claim = await db.update(sequencesTable)
        .set({ renderStatus: "rendering", updatedAt: new Date() })
        .where(and(eq(sequencesTable.id, id), eq(sequencesTable.renderStatus, sequence.renderStatus)))
        .returning({ id: sequencesTable.id });
      if (claim.length === 0) {
        res.status(409).json({ error: "A render is already running on this cut." });
        return;
      }
      claimed = true;

      // ---- the shots, as bytes ----
      const byId = new Map(clipRows.map(c => [c.id, c]));
      const sources: ClipSource[] = [];
      for (const [i, planned] of plan.clips.entries()) {
        const row = byId.get((planned as PlannedClip).id);
        if (!row) continue;
        const url = await resolveClipVideoUrl(row);
        const buffer = url ? await readFileByUrl(url) : null;
        if (!buffer) {
          /*
           * Named by shot, not by id. "Clip 2's file could not be read" is
           * something a person can act on; a uuid is not.
           */
          throw new Error(
            `Shot ${i + 1}'s video could not be read, so nothing was rendered. ` +
            `Replace that shot or remove it.`,
          );
        }
        sources.push({ clip: planned, buffer, label: `Shot ${i + 1}` });
      }

      const assembled = await assembleCut({
        sources,
        filterComplex: plan.filterComplex,
        outputLabel: plan.outputLabel,
      });
      const warnings = [...plan.warnings, ...assembled.warnings];

      // ---- the sound, laid on ----
      let finalBuffer = assembled.videoBuffer;
      let durationMs = assembled.measuredDurationMs;

      const playable = trackRows.filter(t => typeof t.audioUrl === "string" && t.audioUrl);
      if (playable.length > 0) {
        const inputs: MixInput[] = [];
        for (const t of playable) {
          const buf = await readFileByUrl(t.audioUrl);
          if (!buf) {
            // A track that cannot be read is dropped from the mix and SAID, not
            // silently missing from a file nobody will re-listen to.
            warnings.push(`The ${t.trackKind} track's audio could not be read, so it is not in this render.`);
            continue;
          }
          inputs.push({
            id: t.id,
            trackKind: t.trackKind,
            startMs: t.startMs,
            durationMs: t.durationMs,
            gainDb: t.gainDb,
            duckUnder: t.duckUnder,
            duckAmountDb: t.duckAmountDb,
            audioBuffer: buf,
          });
        }
        if (inputs.length > 0) {
          const mixed = await renderMix({
            videoBuffer: assembled.videoBuffer,
            tracks: inputs,
            // Held to the picture. Without this the mix's own length decides,
            // and a short voiceover cuts the cut off — see audio-merge.ts.
            videoDurationSeconds: assembled.measuredDurationMs / 1000,
          });
          finalBuffer = mixed.videoBuffer;
          warnings.push(...mixed.warnings);
          durationMs = (await measureDurationMs(finalBuffer)) ?? assembled.measuredDurationMs;
        }
      }

      const filename = `sequence-cut-${crypto.randomUUID()}.mp4`;
      await writeBuffer("generated", filename, finalBuffer);
      const videoUrl = `/api/files/generated/${filename}`;

      // ---- the cut takes the motion slot's place ----
      const [assetStage] = await db
        .select({ id: stageStatesTable.id })
        .from(stageStatesTable)
        .where(and(
          eq(stageStatesTable.creativeId, sequence.creativeId),
          eq(stageStatesTable.stageKind, "asset"),
        ));

      let pickImageUrl: string | null = null;
      if (assetStage) {
        const [pick] = await db
          .select({ payload: stageTakesTable.payload })
          .from(stageTakesTable)
          .where(and(
            eq(stageTakesTable.stageStateId, assetStage.id),
            eq(stageTakesTable.slotKey, "selected"),
            eq(stageTakesTable.isCurrent, true),
          ));
        const p = pick?.payload as { imageUrl?: unknown } | undefined;
        pickImageUrl = typeof p?.imageUrl === "string" ? p.imageUrl : null;
      }

      const durationSeconds = Number((durationMs / 1000).toFixed(2));
      /*
       * `sourceImageUrl` is the PICK, deliberately. In ship's vocabulary that
       * field answers "which still does this clip belong to", and a cut belongs
       * to the post's picture: re-pick upstream and ship correctly refuses to
       * carry the cut against a picture it was not built beside. The cut's real
       * lineage — every shot and the take it came from — is in `cut` below,
       * so nothing is lost by reusing the field the publish path already reads.
       */
      const payload = {
        videoUrl,
        sourceImageUrl: pickImageUrl,
        sourceSlotKey: "sequence",
        instruction: null,
        durationSeconds,
        costUsd: 0,
        cut: {
          sequenceId: id,
          shots: plan.clips.length,
          fingerprint: status.fingerprint,
          clips: plan.clips.map((c, i) => {
            const row = byId.get((c as PlannedClip).id);
            return {
              shot: i + 1,
              sourceKind: row?.sourceKind ?? null,
              sourceTakeId: row?.sourceTakeId ?? null,
              sourceVariantId: row?.sourceVariantId ?? null,
              sourceAssetId: row?.sourceAssetId ?? null,
              durationMs: c.durationMs,
              transitionIn: c.transitionIn,
            };
          }),
          tracks: trackRows.map(t => ({ id: t.id, trackKind: t.trackKind, gainDb: t.gainDb })),
        },
        material: {
          renderedBy: "ffmpeg",
          referenceCount: 0,
          identityLock: false,
          /** What the render did not do, kept with the thing it produced. */
          warnings,
        },
      };

      await db.transaction(async (tx) => {
        await tx.update(sequencesTable).set({
          renderedUrl: videoUrl,
          renderStatus: "rendered",
          // Measured, not planned: the row that says "rendered" has to be true
          // about the file, and a studio clip's stored length is an estimate.
          totalDurationMs: durationMs,
          renderFingerprint: status.fingerprint,
          updatedAt: new Date(),
        }).where(eq(sequencesTable.id, id));

        if (assetStage) {
          await tx.update(stageTakesTable)
            .set({ isCurrent: false })
            .where(and(
              eq(stageTakesTable.stageStateId, assetStage.id),
              eq(stageTakesTable.slotKey, "motion"),
            ));
          const prior = await tx
            .select({ slotKey: stageTakesTable.slotKey, takeIndex: stageTakesTable.takeIndex })
            .from(stageTakesTable)
            .where(and(
              eq(stageTakesTable.stageStateId, assetStage.id),
              eq(stageTakesTable.slotKey, "motion"),
            ));
          await tx.insert(stageTakesTable).values({
            stageStateId: assetStage.id,
            slotKey: "motion",
            takeIndex: nextTakeIndex(prior, "motion"),
            origin: "generated",
            payload,
            isCurrent: true,
            costCents: 0,
          });
        }
      });
      claimed = false;

      res.json({
        renderedUrl: videoUrl,
        durationMs,
        durationSeconds,
        shots: plan.clips.length,
        /** Free, and named as free rather than priced at a guess. */
        costUsd: 0,
        warnings,
        /** The graphs that made it, for anyone who has to debug the result. */
        filterComplex: assembled.filterComplex,
        carriedToShip: Boolean(assetStage),
      });
    } catch (err) {
      if (claimed) {
        /*
         * A claim that is not released reads as "rendering" forever and blocks
         * every retry, so failing has to say so on the row.
         */
        try {
          await db.update(sequencesTable)
            .set({ renderStatus: "failed", updatedAt: new Date() })
            .where(eq(sequencesTable.id, id));
        } catch { /* best effort */ }
      }
      console.error("Cut render failed", err);
      const message = err instanceof Error && /^Shot \d/.test(err.message)
        ? err.message
        : "The cut could not be rendered. Nothing was published.";
      res.status(500).json({ error: message });
    }
  },
);

export default router;
