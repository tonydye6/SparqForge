import { Router, type IRouter, type Request, type Response } from "express";
import { db, assetsTable, brandsTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { requireStandardWrite } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate.js";
import {
  BRAND_FIELDS,
  harvestColors,
  scoreBrand,
  type FieldSource,
} from "../services/brand-completeness.js";

/**
 * Phase 5 · the brand record, surfaced.
 *
 * These fields already existed and already drove every generation; what was
 * missing was anywhere to see them, so nobody could tell what the Studio was
 * guessing. Crown U was found in use with no default director and no style
 * profile, and nothing anywhere said so.
 *
 * Two rules shape this route. Completeness is recomputed from the record on
 * every read rather than trusted from the stored column, because a column that
 * drifts from the fields it summarises is worse than no column. And every write
 * stamps provenance, so an extracted or harvested value can never be mistaken
 * for one a person chose (§1.17).
 */

const router: IRouter = Router();

/** Only fields the Studio actually reads may be written here. */
const WRITABLE = new Set(BRAND_FIELDS.map(f => f.key));

const PatchBody = z.object({
  fields: z.record(z.string(), z.unknown()),
  /**
   * Who decided these values. Defaults to the human, because this endpoint is
   * the screen: extraction and harvesting pass their own source explicitly.
   */
  source: z.enum(["user", "guide", "learned"]).default("user"),
});

router.get("/brands/:brandId/record", async (req: Request, res: Response): Promise<void> => {
  const brandId = String(req.params.brandId);
  try {
    const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
    if (!brand) {
      res.status(404).json({ error: "Brand not found" });
      return;
    }

    const provenance = (brand.fieldProvenance ?? {}) as Record<string, FieldSource>;
    const completeness = scoreBrand(brand as unknown as Record<string, unknown>, provenance);

    /*
     * Candidate colours from the brand's OWN library, which already carries
     * analysed colours per asset and has never been read for this. Suggestions
     * only: they are confirmed by a human, and confirming is what stamps
     * provenance. Writing them straight in would be the automation-becomes-brand-
     * law failure this record exists to prevent.
     */
    const assets = await db
      .select({ colors: assetsTable.colors })
      .from(assetsTable)
      .where(and(eq(assetsTable.brandId, brandId), ne(assetsTable.status, "archived")));
    const harvested = harvestColors(assets.map(a => (a.colors ?? []) as string[]));

    res.json({
      brand: {
        id: brand.id,
        name: brand.name,
        ...Object.fromEntries(BRAND_FIELDS.map(f => [f.key, (brand as unknown as Record<string, unknown>)[f.key] ?? null])),
      },
      completeness: {
        score: completeness.score,
        filledCount: completeness.filledCount,
        total: completeness.fields.length,
        cold: completeness.cold,
        fields: completeness.fields.map(f => ({
          key: f.spec.key,
          label: f.spec.label,
          consumedBy: f.spec.consumedBy,
          weight: f.spec.weight,
          costWhenMissing: f.spec.costWhenMissing,
          filled: f.filled,
          source: f.source,
        })),
      },
      harvested,
      guideFileUrl: brand.brandGuideFileUrl ?? null,
    });
  } catch (err) {
    console.error("Failed to read the brand record", err);
    res.status(500).json({ error: "The brand record could not be read." });
  }
});

router.patch(
  "/brands/:brandId/record",
  requireStandardWrite,
  validateRequest({ body: PatchBody }),
  async (req: Request, res: Response): Promise<void> => {
    const brandId = String(req.params.brandId);
    const { fields, source } = req.body as z.infer<typeof PatchBody>;

    try {
      const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
      if (!brand) {
        res.status(404).json({ error: "Brand not found" });
        return;
      }

      // Only known fields, and named in the error rather than silently dropped:
      // a write that vanishes without comment is how a user comes to believe
      // they set something they did not.
      const unknownKeys = Object.keys(fields).filter(k => !WRITABLE.has(k));
      if (unknownKeys.length > 0) {
        res.status(400).json({
          error: `These are not fields the Studio reads, so nothing was saved: ${unknownKeys.join(", ")}.`,
        });
        return;
      }
      if (Object.keys(fields).length === 0) {
        res.status(400).json({ error: "No fields were sent, so nothing was saved." });
        return;
      }

      const merged = { ...(brand as unknown as Record<string, unknown>), ...fields };
      const provenance = { ...((brand.fieldProvenance ?? {}) as Record<string, FieldSource>) };
      for (const key of Object.keys(fields)) provenance[key] = source;

      const completeness = scoreBrand(merged, provenance);

      // Keys are already validated against WRITABLE above, which is derived from
      // BRAND_FIELDS, so this cast narrows a checked set rather than waving
      // anything through. `completenessScore` is recomputed on write and again
      // on every read: the column is a cache for list views, never the truth.
      const setPayload = {
        ...fields,
        fieldProvenance: provenance,
        completenessScore: completeness.score,
        updatedAt: new Date(),
      } as Partial<typeof brandsTable.$inferInsert>;

      await db.update(brandsTable).set(setPayload).where(eq(brandsTable.id, brandId));

      res.json({ ok: true, score: completeness.score, updated: Object.keys(fields), source });
    } catch (err) {
      console.error("Failed to write the brand record", err);
      res.status(500).json({ error: "The brand record could not be saved." });
    }
  },
);

export default router;
