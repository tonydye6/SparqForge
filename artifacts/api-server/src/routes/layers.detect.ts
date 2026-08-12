/**
 * Stage 03 · Refine · running the decomposition.
 *
 * The I/O half of increment 5b. One vision pass over the take, the rules in
 * `services/layer-detection.ts` applied to what comes back, the rows matched to
 * the known cast, and the set written as a set.
 *
 * Priced before it runs and metered by what it used. Detection is a text-model
 * call over one image — the probe measured ~1.4k input, ~200 output and
 * ~750-1150 thinking tokens, which is the same order as every other Gemini text
 * call in the Studio, so it is charged at the same flat estimate rather than at
 * a number invented for this feature.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  assetsTable,
  brandsTable,
  costLogsTable,
  creativesTable,
  stageStatesTable,
  stageTakesTable,
  takeLayersTable,
} from "@workspace/db";
import { z } from "zod";
import { ai } from "@workspace/integrations-gemini-ai";
import { str } from "../lib/http-params.js";
import { AI_MODELS, estimateGeminiTextCost } from "../lib/ai-config.js";
import { extractJSON } from "../lib/extract-json.js";
import { reserveBudget, budgetExceededBody } from "../lib/budget.js";
import { generationLimiter } from "../lib/rate-limit.js";
import { requireStandardWrite } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate.js";
import { buildCostRow } from "../services/cost-recording.js";
import { readFileByUrl } from "../services/reference-images.js";
import {
  attributeToCast,
  detectionSummary,
  normalizeDetected,
  DETECTION_PROMPT,
  type DetectedLayer,
} from "../services/layer-detection.js";
import { castLayers, castOfLineage, lineagePayloads, type CastAsset } from "../services/take-layers.js";

const router: IRouter = Router();

const DetectBody = z.object({ slotKey: z.string().min(1) });

router.post(
  "/creatives/:creativeId/stages/:stageId/detect-layers",
  requireStandardWrite,
  generationLimiter,
  validateRequest({ body: DetectBody }),
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = str(req.params.creativeId);
    const stageId = str(req.params.stageId);
    const { slotKey } = req.body as z.infer<typeof DetectBody>;
    let reservationId: string | null = null;

    try {
      const [creative] = await db
        .select({ id: creativesTable.id, brandId: creativesTable.brandId })
        .from(creativesTable)
        .where(eq(creativesTable.id, creativeId));
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

      const slotTakes = await db
        .select({
          id: stageTakesTable.id,
          takeIndex: stageTakesTable.takeIndex,
          payload: stageTakesTable.payload,
          isCurrent: stageTakesTable.isCurrent,
        })
        .from(stageTakesTable)
        .where(and(eq(stageTakesTable.stageStateId, stageId), eq(stageTakesTable.slotKey, slotKey)));
      const take = slotTakes.find(t => t.isCurrent);
      if (!take) {
        res.status(404).json({ error: "That slot has no current take, so there is nothing to take apart." });
        return;
      }

      const imageUrl = (take.payload as { imageUrl?: unknown } | null)?.imageUrl;
      if (typeof imageUrl !== "string") {
        res.status(400).json({ error: "That take has no image, so nothing was charged." });
        return;
      }
      const buffer = await readFileByUrl(imageUrl);
      if (!buffer) {
        res.status(400).json({ error: "The image for that take could not be read, so nothing was charged." });
        return;
      }

      const budget = await reserveBudget(creativeId, estimateGeminiTextCost());
      if (!budget.ok) {
        res.status(429).json(budgetExceededBody(budget.todaySpend, budget.threshold));
        return;
      }
      reservationId = budget.reservationId;

      /*
       * BLIND. No cast hint — the A/B in layer-detection.ts's header found the
       * hint suppresses discovery while adding nothing the pixels do not
       * already say. The cast is applied AFTER, as attribution.
       */
      const response = await ai.models.generateContent({
        model: AI_MODELS.GEMINI_FLASH_TEXT,
        contents: [{
          role: "user",
          parts: [
            { inlineData: { data: buffer.toString("base64"), mimeType: "image/png" } },
            { text: DETECTION_PROMPT },
          ],
        }],
      });

      const text = (response.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? "")
        .join("");
      let detected: DetectedLayer[];
      try {
        detected = normalizeDetected(extractJSON<unknown>(text));
      } catch {
        /*
         * An unreadable answer is not repaired into layers. The call happened
         * and is billed upstream either way, so the cost row still goes in —
         * hiding a real spend would be the worse lie.
         */
        detected = [];
      }

      // The cast, exactly as the free read model computes it.
      const cast = castOfLineage(lineagePayloads(slotTakes, take.id));
      const assetRows = cast.length
        ? await db
            .select({
              id: assetsTable.id,
              name: assetsTable.name,
              assetClass: assetsTable.assetClass,
              generationRole: assetsTable.generationRole,
              brandLayer: assetsTable.brandLayer,
              franchise: assetsTable.franchise,
              depictedEntities: assetsTable.depictedEntities,
              fileUrl: assetsTable.fileUrl,
              thumbnailUrl: assetsTable.thumbnailUrl,
            })
            .from(assetsTable)
            .where(and(
              eq(assetsTable.brandId, creative.brandId),
              inArray(assetsTable.id, cast.map(c => c.assetId)),
            ))
        : [];
      const [brand] = await db
        .select({ name: brandsTable.name })
        .from(brandsTable)
        .where(eq(brandsTable.id, creative.brandId));
      const known = castLayers({ cast, assets: assetRows as CastAsset[], brandName: brand?.name ?? null });

      const attributed = attributeToCast(detected, known);

      await db.transaction(async (tx) => {
        // Supersede rather than delete: a re-detect must not destroy the
        // decomposition somebody has been editing against.
        await tx
          .update(takeLayersTable)
          .set({ isCurrent: false })
          .where(and(eq(takeLayersTable.stageTakeId, take.id), eq(takeLayersTable.isCurrent, true)));

        if (attributed.length > 0) {
          await tx.insert(takeLayersTable).values(attributed.map((l, i) => ({
            stageTakeId: take.id,
            layerIndex: i + 1,
            name: l.name,
            kind: l.kind,
            origin: "detected" as const,
            assetId: l.assetId,
            bbox: l.bbox,
            isCurrent: true,
          })));
        }

        if (reservationId) await tx.delete(costLogsTable).where(eq(costLogsTable.id, reservationId));
        await tx.insert(costLogsTable).values(buildCostRow({
          creativeId,
          brandId: creative.brandId,
          service: "gemini",
          operation: "layer_detection",
          model: AI_MODELS.GEMINI_FLASH_TEXT,
          costUsd: estimateGeminiTextCost(),
          stageTakeId: take.id,
          inputTokens: response.usageMetadata?.promptTokenCount ?? null,
          // Thinking tokens are billed as output, so a report that left them
          // out would understate what this call actually cost.
          outputTokens:
            (response.usageMetadata?.candidatesTokenCount ?? 0) +
            (response.usageMetadata?.thoughtsTokenCount ?? 0) || null,
        }));
      });
      reservationId = null;

      const rows = await db
        .select()
        .from(takeLayersTable)
        .where(and(eq(takeLayersTable.stageTakeId, take.id), eq(takeLayersTable.isCurrent, true)))
        .orderBy(asc(takeLayersTable.layerIndex));

      res.json({
        takeId: take.id,
        detectedCount: rows.length,
        summary: detectionSummary(attributed),
        costUsd: estimateGeminiTextCost(),
      });
    } catch (err) {
      if (reservationId) {
        try { await db.delete(costLogsTable).where(eq(costLogsTable.id, reservationId)); } catch { /* best effort */ }
      }
      console.error("Layer detection failed", err);
      res.status(500).json({ error: "This picture could not be taken apart. Nothing was charged." });
    }
  },
);

export default router;
