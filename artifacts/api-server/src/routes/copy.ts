import { Router, type IRouter, type Request, type Response } from "express";
import { db, creativesTable, costLogsTable, stageStatesTable, stageTakesTable } from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { requireStandardWrite } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate.js";
import { generationLimiter } from "../lib/rate-limit.js";
import { nextTakeIndex } from "../services/stage-graph.js";
import { readFileByUrl } from "../services/reference-images.js";
import { generateImageFromPrompt, type ReferenceImage } from "../services/imagen.js";
import { writeBuffer } from "../services/storage.js";
import { imagePass, AI_MODELS, estimateClaudeCost } from "../lib/ai-config.js";
import { buildCostRow } from "../services/cost-recording.js";
import { buildImageAwareCaption } from "../services/session-service.js";
import { splitTrailingHashtags } from "../services/copy-stage.js";

/**
 * Stage 03 → 04 · the handoff, and stage 04 Copy's model call.
 *
 * The handoff existed only halfway: picking a take already recorded a choice in
 * the "selected" slot, but stage 03 never marked itself decided and nothing
 * downstream was told. A live check found the Image stage sitting at
 * status "empty" with 73 takes on it, and there was no way forward at all.
 *
 * So "use this take" does three things that have to happen together:
 *   1. record WHICH take is the stage's output
 *   2. mark stage 03 decided, so the spine stops calling it empty
 *   3. write consumedFrom on stage 04, so the dependency edge is REAL and
 *      re-opening Image correctly marks Copy stale
 *
 * Step 3 is the one worth guarding: without it the spine's central promise is
 * silently not kept across the seam between the two stages that matter most.
 */

const router: IRouter = Router();

const UseTakeBody = z.object({
  /** The Explore slot being promoted, e.g. "as_briefed__raw". */
  slotKey: z.string().min(1).max(64),
});

router.post(
  "/creatives/:creativeId/use-take",
  requireStandardWrite,
  validateRequest({ body: UseTakeBody }),
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);
    const { slotKey } = req.body as z.infer<typeof UseTakeBody>;

    try {
      const stages = await db
        .select()
        .from(stageStatesTable)
        .where(eq(stageStatesTable.creativeId, creativeId));
      const [creativeRow] = await db
        .select({ brandId: creativesTable.brandId })
        .from(creativesTable)
        .where(eq(creativesTable.id, creativeId));
      // Attribution written at spend time, so deleting the creative later cannot
      // orphan the full render's cost the way it once orphaned every other row.
      const creativeBrandId = creativeRow?.brandId ?? null;

      const image = stages.find(s => s.stageKind === "asset");
      const copy = stages.find(s => s.stageKind === "copy");
      if (!image || !copy) {
        res.status(404).json({ error: "This creative does not have both an Image and a Copy stage yet." });
        return;
      }
      if (image.status === "locked") {
        res.status(409).json({ error: "The Image stage is locked, so its output cannot be changed. Unlock it first." });
        return;
      }

      // The take being promoted must exist and must have produced an image.
      const [chosen] = await db
        .select({ id: stageTakesTable.id, payload: stageTakesTable.payload })
        .from(stageTakesTable)
        .where(
          and(
            eq(stageTakesTable.stageStateId, image.id),
            eq(stageTakesTable.slotKey, slotKey),
            eq(stageTakesTable.isCurrent, true),
          ),
        );
      const chosenPayload = chosen?.payload as {
        imageUrl?: unknown;
        pass?: unknown;
        renderPrompt?: unknown;
        material?: { directorSelections?: Array<{ assetId: string; role: string }> };
      } | undefined;
      const previewUrl = chosenPayload?.imageUrl;
      if (typeof previewUrl !== "string") {
        res.status(400).json({ error: "That take has not rendered an image, so it cannot be the stage's output." });
        return;
      }

      /*
       * THE SECOND PASS. Phase 7 item 2.
       *
       * A spread renders at the cheap tier; only the take somebody actually
       * keeps is worth full-resolution money. Eight previews plus one full
       * render is $0.40 against $1.07 for eight pro renders, and the previews
       * arrive in about a fifth of the time.
       *
       * THE PREVIEW ITSELF GOES IN AS A SUBJECT REFERENCE, and that is the
       * whole trick. Re-rendering from the prompt alone produces a DIFFERENT
       * PICTURE — measured, not assumed: the same prompt and references at the
       * two tiers gave a different pose, framing and crowd. You would pick
       * image X and ship image Y, which makes the spread a lie about what you
       * were choosing between. Feeding the preview back returns the same shot
       * at higher fidelity; verified across three briefs by eye.
       *
       * FAILS OPEN. If the full render errors, promotion still succeeds and the
       * preview stays the stage output. A creative that cannot move to Copy
       * because a nice-to-have upgrade failed would be a worse outcome than a
       * slightly softer image, and the response says which one you got.
       */
      let imageUrl = previewUrl;
      let fullRender: { costUsd: number; model: string } | null = null;
      let fullRenderError: string | null = null;

      if (chosenPayload?.pass === "preview" && typeof chosenPayload.renderPrompt === "string") {
        try {
          const { model, usdPerImage } = imagePass("full");
          const previewBuf = await readFileByUrl(previewUrl);
          if (!previewBuf) throw new Error("the preview's bytes could not be read");

          /*
           * THE PREVIEW IS THE ONLY REFERENCE. This started as preview plus the
           * original subject assets, and the first live run showed why that is
           * wrong: the refined image kept the pose and the character but changed
           * the shorts from navy to gold and added a "3" to the jersey.
           *
           * I first wrote that off as the model taking licence. It is not. Those
           * are details from the ORIGINAL Crown U asset, which was still in the
           * reference list — so the pro model was being shown two versions of the
           * same character and blended them. The preview already contains the
           * subject, faithfully, because it was generated from that same asset
           * one pass earlier. Sending the original again adds no identity the
           * preview lacks and gives the model a second, conflicting opinion
           * about what the character looks like.
           *
           * A refine has exactly one job: this picture, made better.
           */
          const refs: ReferenceImage[] = [
            { imageBuffer: previewBuf, mimeType: "image/png", role: "subject_reference" },
          ];

          const image = await generateImageFromPrompt(
            `${chosenPayload.renderPrompt}\n\nRender THIS EXACT COMPOSITION at full fidelity: same ` +
              `pose, same camera angle, same framing, same lighting. Improve detail and material ` +
              `quality only. Change nothing else.`,
            "instagram_feed",
            refs,
            model,
          );
          const filename = `full-${creativeId}-${slotKey}-${crypto.randomUUID().slice(0, 8)}.png`;
          await writeBuffer("generated", filename, image.imageBuffer);
          imageUrl = `/api/files/generated/${filename}`;
          fullRender = { costUsd: usdPerImage, model };
        } catch (e) {
          fullRenderError = e instanceof Error ? e.message : String(e);
          console.error("Full render of the kept take failed; keeping the preview", e);
        }
      }

      await db.transaction(async (tx) => {
        // One current "selected" take, superseding rather than overwriting, so
        // the history of what was chosen before survives.
        await tx
          .update(stageTakesTable)
          .set({ isCurrent: false })
          .where(and(eq(stageTakesTable.stageStateId, image.id), eq(stageTakesTable.slotKey, "selected")));
        const existing = await tx
          .select({ slotKey: stageTakesTable.slotKey, takeIndex: stageTakesTable.takeIndex })
          .from(stageTakesTable)
          .where(and(eq(stageTakesTable.stageStateId, image.id), eq(stageTakesTable.slotKey, "selected")));
        await tx.insert(stageTakesTable).values({
          stageStateId: image.id,
          slotKey: "selected",
          takeIndex: nextTakeIndex(existing, "selected"),
          origin: "swapped_in",
          payload: { slotKey, imageUrl },
          isCurrent: true,
        });

        // Stage 03 is decided. It was reporting "empty" while holding dozens of
        // takes, which made the spine describe finished work as never started.
        await tx
          .update(stageStatesTable)
          .set({ status: "done", decidedAt: new Date(), updatedAt: new Date() })
          .where(eq(stageStatesTable.id, image.id));

        // The dependency edge, recorded rather than assumed (§1.3). Merged, so a
        // Copy stage that also consumed the brief keeps both edges.
        const merged = new Set([...(copy.consumedFrom ?? []), image.id]);
        merged.delete(copy.id);
        await tx
          .update(stageStatesTable)
          .set({ consumedFrom: [...merged], updatedAt: new Date() })
          .where(eq(stageStatesTable.id, copy.id));

        /*
         * Phase 7 item 3 — promotion is what decides which spend was kept.
         *
         * This is THE cull event. A spread gives every take its own slotKey, so
         * `isCurrent` cannot answer "which one won" — each take is current in
         * its own slot. Choosing happens exactly here, and until now nothing
         * told `cost_logs` about it, so every preview stayed `wasUsed = false`
         * forever and the Cost surface reported 100% of a spread as waste.
         *
         * Reset-then-set, rather than only setting the winner, because
         * promotion SUPERSEDES: pick take 3, change your mind, pick take 6, and
         * without the reset both would read as kept and the money spent would
         * exceed the money the spread cost. The reset is scoped to this Image
         * stage so other creatives are untouched.
         *
         * `was_used IS NOT NULL` guards both statements. NULL means "not part of
         * a two-pass flow" — a full-render spread, or pre-M2 history — and
         * writing a boolean over it would invent a claim about takes nobody ever
         * previewed.
         */
        const takesInStage = tx
          .select({ id: stageTakesTable.id })
          .from(stageTakesTable)
          .where(eq(stageTakesTable.stageStateId, image.id));

        await tx
          .update(costLogsTable)
          .set({ wasUsed: false })
          .where(
            and(
              inArray(costLogsTable.stageTakeId, takesInStage),
              isNotNull(costLogsTable.wasUsed),
            ),
          );
        await tx
          .update(costLogsTable)
          .set({ wasUsed: true })
          .where(
            and(
              eq(costLogsTable.stageTakeId, chosen.id),
              isNotNull(costLogsTable.wasUsed),
            ),
          );

        /*
         * The full render's own row. `wasUsed: true` because a full render is
         * only ever made for a take somebody kept — there is no such thing as a
         * wasted second pass. It carries the same `stageTakeId`, so the take
         * now owns both halves of what it cost.
         */
        if (fullRender) {
          await tx.insert(costLogsTable).values(buildCostRow({
            creativeId,
            brandId: creativeBrandId,
            service: "gemini",
            operation: "explore_full_render",
            model: fullRender.model,
            costUsd: fullRender.costUsd,
            passType: "full",
            wasUsed: true,
            stageTakeId: chosen.id,
          }));
        }

        // The take now points at the full render, so every surface that reads
        // the take — not just the stage output — shows what actually shipped.
        if (fullRender) {
          await tx
            .update(stageTakesTable)
            .set({ payload: { ...chosenPayload, imageUrl, previewUrl, pass: "full" } })
            .where(eq(stageTakesTable.id, chosen.id));
        }
      });

      res.json({
        ok: true,
        imageStageId: image.id,
        copyStageId: copy.id,
        slotKey,
        imageUrl,
        // Say which image you got. A caller cannot tell a full render from a
        // preview by looking at the URL, and the difference is what it cost.
        pass: fullRender ? "full" : (chosenPayload?.pass ?? null),
        fullRender,
        fullRenderError,
      });
    } catch (err) {
      console.error("Failed to use this take", err);
      res.status(500).json({ error: "That take could not be made the stage's output." });
    }
  },
);

/**
 * Draft copy from the chosen image.
 *
 * Reuses `buildImageAwareCaption`, which already sees the picture and already
 * carries voice examples, taste guidance, intent directives and hashtag
 * strategy. Writing a second caption engine here is precisely the mistake that
 * produced the stage-03 fidelity bug, so this route is plumbing rather than
 * intelligence.
 *
 * Drafting is OFFERED, never automatic: typing is stage 04's primary path
 * (§1.12), and this costs a model call.
 */
router.post(
  "/creatives/:creativeId/copy-draft",
  requireStandardWrite,
  generationLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = String(req.params.creativeId);

    try {
      const [creative] = await db.select().from(creativesTable).where(eq(creativesTable.id, creativeId));
      if (!creative) {
        res.status(404).json({ error: "Creative not found" });
        return;
      }

      const stages = await db
        .select()
        .from(stageStatesTable)
        .where(eq(stageStatesTable.creativeId, creativeId));
      const [creativeRow] = await db
        .select({ brandId: creativesTable.brandId })
        .from(creativesTable)
        .where(eq(creativesTable.id, creativeId));
      // Attribution written at spend time, so deleting the creative later cannot
      // orphan the full render's cost the way it once orphaned every other row.
      const creativeBrandId = creativeRow?.brandId ?? null;

      const image = stages.find(s => s.stageKind === "asset");
      if (!image) {
        res.status(404).json({ error: "This creative has no Image stage." });
        return;
      }

      const [selected] = await db
        .select({ payload: stageTakesTable.payload })
        .from(stageTakesTable)
        .where(
          and(
            eq(stageTakesTable.stageStateId, image.id),
            eq(stageTakesTable.slotKey, "selected"),
            eq(stageTakesTable.isCurrent, true),
          ),
        );
      const imageUrl = (selected?.payload as { imageUrl?: unknown } | undefined)?.imageUrl;
      if (typeof imageUrl !== "string") {
        res.status(400).json({
          error: "Pick a take on the Image stage first. Copy is written against the picture, not in the abstract.",
        });
        return;
      }

      const buffer = await readFileByUrl(imageUrl);
      if (!buffer) {
        res.status(400).json({ error: "The chosen image could not be read, so copy cannot be written against it." });
        return;
      }

      // The brief the user actually typed, same source stage 03 reads.
      const brief = stages.find(s => s.stageKind === "brief");
      let briefText = creative.briefText ?? "";
      if (brief) {
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
        const line = (take?.payload as { line?: unknown } | undefined)?.line;
        if (typeof line === "string" && line.trim()) briefText = line.trim();
      }

      const { captions } = await buildImageAwareCaption({
        brandId: creative.brandId,
        briefText,
        imageBuffer: buffer,
        imageMimeType: imageUrl.endsWith(".jpeg") || imageUrl.endsWith(".jpg") ? "image/jpeg" : "image/png",
        intent: creative.intent,
      });

      /*
       * The draft is a real vision call and the legacy path has always billed
       * its equivalent; this one wrote nothing (doc 39 §5.1 — found by reading
       * the ledger straight after pressing the button). Best effort: a failed
       * insert never loses the drafted copy.
       */
      try {
        await db.insert(costLogsTable).values(buildCostRow({
          creativeId,
          brandId: creativeBrandId,
          service: "anthropic",
          operation: "copy_draft",
          model: AI_MODELS.CLAUDE_SONNET,
          costUsd: estimateClaudeCost(),
        }));
      } catch (err) {
        console.error("Cost row for copy_draft could not be written", err);
      }

      /*
       * Hashtags are split OUT of the caption body here.
       *
       * The caption engine writes them inline because the legacy fan-out posts
       * one string. Stage 04 gives them their own slot with per-channel counts,
       * so leaving them in the body would show the user a voice-check warning
       * about text we put there ourselves.
       */
      const drafted = Object.fromEntries(
        Object.entries(captions).map(([platform, v]) => {
          const raw = (v as { caption: string; headline: string }).caption ?? "";
          const { body, hashtags } = splitTrailingHashtags(raw);
          return [platform, { caption: body, hashtags, headline: (v as { headline: string }).headline ?? "" }];
        }),
      );

      res.json({ drafted, imageUrl });
    } catch (err) {
      console.error("Failed to draft copy", err);
      res.status(500).json({ error: "The copy could not be drafted. Nothing was saved." });
    }
  },
);

export default router;
