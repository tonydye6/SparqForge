/**
 * Stage 03 · Refine · the layer read model.
 *
 * What one take is made of, as an ordered back-to-front list of named layers.
 * This is increment 5a of doc 45's layer-decomposition plan, corrected: see the
 * header of `services/take-layers.ts` for why the free first class is the CAST
 * rather than a reconstructed composite.
 *
 * **Why a read model rather than the client assembling it.** The client holds
 * the take payload already, so it could technically join the asset rows itself.
 * It must not. Which attached files count as layers, what each one is CALLED,
 * and — the load-bearing one — which layers have a location and which only have
 * an identity are all judgements, and a client that made them differently would
 * put a box on the canvas around pixels nobody measured. The same reason
 * `routes/storyboard.ts` owns its own price.
 *
 * Free: no model call, no writes, nothing derived that is not already recorded.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db, assetsTable, brandsTable, creativesTable, stageStatesTable, stageTakesTable, takeLayersTable,
} from "@workspace/db";
import { str } from "../lib/http-params.js";
import {
  castLayers,
  castOfLineage,
  layersSummary,
  lineagePayloads,
  mergeLayers,
  type CastAsset,
  type DetectedRow,
} from "../services/take-layers.js";

const router: IRouter = Router();

router.get(
  "/creatives/:creativeId/stages/:stageId/layers",
  async (req: Request, res: Response): Promise<void> => {
    const creativeId = str(req.params.creativeId);
    const stageId = str(req.params.stageId);
    const slotKey = typeof req.query.slotKey === "string" ? req.query.slotKey : "";

    if (!slotKey) {
      res.status(400).json({ error: "Say which slot to decompose." });
      return;
    }

    const [creative] = await db
      .select({ id: creativesTable.id, brandId: creativesTable.brandId })
      .from(creativesTable)
      .where(eq(creativesTable.id, creativeId));
    if (!creative) {
      res.status(404).json({ error: "Creative not found" });
      return;
    }

    const [stage] = await db
      .select({ id: stageStatesTable.id })
      .from(stageStatesTable)
      .where(and(eq(stageStatesTable.id, stageId), eq(stageStatesTable.creativeId, creativeId)));
    if (!stage) {
      res.status(404).json({ error: "Stage not found on this creative" });
      return;
    }

    /*
     * The whole slot, not just the current take. A refine or a region edit
     * hands the model the previous PICTURE rather than the character file, so
     * its own record names no cast at all — the first walk of this feature
     * found a refined take listing nothing but its base. The lineage is what
     * carries the cast across an edit.
     */
    const slotTakes = await db
      .select({
        id: stageTakesTable.id,
        takeIndex: stageTakesTable.takeIndex,
        payload: stageTakesTable.payload,
        isCurrent: stageTakesTable.isCurrent,
      })
      .from(stageTakesTable)
      .where(and(
        eq(stageTakesTable.stageStateId, stageId),
        eq(stageTakesTable.slotKey, slotKey),
      ));

    const take = slotTakes.find(t => t.isCurrent);
    if (!take) {
      res.status(404).json({ error: "That slot has no current take, so there is nothing to take apart." });
      return;
    }

    const imageUrl = (take.payload as { imageUrl?: unknown } | null)?.imageUrl;
    const cast = castOfLineage(lineagePayloads(slotTakes, take.id));

    /*
     * Scoped to the creative's own brand, not looked up by id alone. An asset
     * id recorded on a take is not authorisation to read a row from another
     * brand's library, and the layer list is a place a name would leak.
     */
    const assetRows = cast.length === 0
      ? []
      : await db
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
          ));

    const [brand] = await db
      .select({ name: brandsTable.name })
      .from(brandsTable)
      .where(eq(brandsTable.id, creative.brandId));

    const known = castLayers({
      cast,
      assets: assetRows as CastAsset[],
      brandName: brand?.name ?? null,
    });

    /*
     * The detected set, when one has been run. Only the CURRENT set: a
     * re-detect supersedes rather than deletes, so the superseded rows are
     * still on the record and must not appear twice in the list.
     */
    const detectedRows = await db
      .select({
        id: takeLayersTable.id,
        layerIndex: takeLayersTable.layerIndex,
        name: takeLayersTable.name,
        kind: takeLayersTable.kind,
        assetId: takeLayersTable.assetId,
        bbox: takeLayersTable.bbox,
      })
      .from(takeLayersTable)
      .where(and(eq(takeLayersTable.stageTakeId, take.id), eq(takeLayersTable.isCurrent, true)))
      .orderBy(asc(takeLayersTable.layerIndex));

    const layers = detectedRows.length > 0
      ? mergeLayers(known, detectedRows as DetectedRow[])
      : known;

    res.json({
      slotKey,
      takeId: take.id,
      imageUrl: typeof imageUrl === "string" ? imageUrl : null,
      layers,
      /**
       * True once something has looked at the picture. Until then every row
       * here is provenance — who is in the frame and from which file — and the
       * client must not draw a selection box for a layer with no bbox.
       */
      decomposed: layers.some(l => l.origin === "detected"),
      knownCount: layers.filter(l => l.origin === "known_cast").length,
      /** Carried across an edit rather than recorded on this take. */
      inheritedCount: layers.filter(l => l.origin === "inherited_cast").length,
      locatedCount: layers.filter(l => l.bbox !== null).length,
      summary: layersSummary(layers),
    });
  },
);

export default router;
