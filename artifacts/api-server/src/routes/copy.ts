import { Router, type IRouter, type Request, type Response } from "express";
import { db, creativesTable, stageStatesTable, stageTakesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireStandardWrite } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate.js";
import { generationLimiter } from "../lib/rate-limit.js";
import { nextTakeIndex } from "../services/stage-graph.js";
import { readFileByUrl } from "../services/reference-images.js";
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
        .select({ payload: stageTakesTable.payload })
        .from(stageTakesTable)
        .where(
          and(
            eq(stageTakesTable.stageStateId, image.id),
            eq(stageTakesTable.slotKey, slotKey),
            eq(stageTakesTable.isCurrent, true),
          ),
        );
      const imageUrl = (chosen?.payload as { imageUrl?: unknown } | undefined)?.imageUrl;
      if (typeof imageUrl !== "string") {
        res.status(400).json({ error: "That take has not rendered an image, so it cannot be the stage's output." });
        return;
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
      });

      res.json({ ok: true, imageStageId: image.id, copyStageId: copy.id, slotKey, imageUrl });
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
