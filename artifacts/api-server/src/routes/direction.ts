import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  brandsTable,
  creativesTable,
  creativeVariantsTable,
  designerPersonasTable,
  tasteSignalsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { validateRequest } from "../middleware/validate.js";
import { requireStandardWrite } from "../middleware/auth.js";
import { recordAudit, actorFromRequest } from "../lib/audit.js";
import {
  BRAND_OWNED,
  HOUSE_STYLE_ID,
  buildDirectionSpread,
  type SignalRow,
} from "../services/direction-spread.js";

/**
 * Stage 02 · Direction.
 *
 * Spec: `20_SPEC_00_PRINCIPLES.md` §1.10 and §1.17, `22_IMPLEMENTATION_PLAN.md`
 * item 2, and the Studio artifact screen 05.
 *
 * The ranking, the hit rate and the House-style placement all live in
 * services/direction-spread.ts, which is pure and separately tested. This file
 * only reads rows and hands them over, so the interesting logic stays verifiable
 * on a machine where vitest cannot start.
 *
 * Note there is no model call here, deliberately. Choosing a director is a human
 * decision informed by the brand's own history; nothing needs generating to make
 * it. The plan's note that stage 02 is "the first stage that calls a model" is
 * about the render preview, which is a later increment and an expensive one, so
 * it should be shown to Tony before it is built.
 */

const router: IRouter = Router();

/**
 * The spread for one creative.
 *
 * Signals are scoped to the creative's brand, not to the creative, because a
 * director's record is a property of how they have performed for that brand.
 * Scoping to one creative would make every hit rate read "not enough signal yet".
 */
router.get("/creatives/:creativeId/direction-spread", async (req: Request, res: Response): Promise<void> => {
  const creativeId = String(req.params.creativeId);

  try {
    const [creative] = await db
      .select({ id: creativesTable.id, brandId: creativesTable.brandId })
      .from(creativesTable)
      .where(eq(creativesTable.id, creativeId));
    if (!creative) {
      res.status(404).json({ error: "Creative not found" });
      return;
    }

    const [brand] = await db
      .select({
        id: brandsTable.id,
        name: brandsTable.name,
        defaultPersonaId: brandsTable.defaultPersonaId,
        defaultSpreadSize: brandsTable.defaultSpreadSize,
      })
      .from(brandsTable)
      .where(eq(brandsTable.id, creative.brandId));

    const personas = await db.select().from(designerPersonasTable).orderBy(designerPersonasTable.name);

    // Join signals to the variant that produced them so each one is attributed to
    // the persona that directed it. A signal whose variant has no persona lands
    // under House style rather than being dropped.
    const signalRows = await db
      .select({
        personaId: creativeVariantsTable.personaId,
        signalType: tasteSignalsTable.signalType,
        payload: tasteSignalsTable.payload,
      })
      .from(tasteSignalsTable)
      .innerJoin(creativeVariantsTable, eq(tasteSignalsTable.variantId, creativeVariantsTable.id))
      .where(eq(tasteSignalsTable.brandId, creative.brandId));

    const spread = buildDirectionSpread({
      personas: personas.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        typography: p.typography,
        composition: p.composition,
        colorPhilosophy: p.colorPhilosophy,
        textureAndEffects: p.textureAndEffects,
        mood: p.mood,
        referenceImages: p.referenceImages,
      })),
      signals: signalRows as SignalRow[],
      defaultPersonaId: brand?.defaultPersonaId ?? null,
    });

    res.json({
      spread,
      // Rendered beside the spread so §1.10 is visible rather than merely true.
      brandOwned: BRAND_OWNED,
      brandId: creative.brandId,
      brandName: brand?.name ?? null,
      defaultPersonaId: brand?.defaultPersonaId ?? null,
      defaultSpreadSize: brand?.defaultSpreadSize ?? 8,
      // Judged signals only, summed off the cards themselves. The raw joined
      // count would be larger because it includes vary, regenerate and the edit
      // signals, which are deliberately not verdicts: quoting that number as
      // "judged" would overstate how much evidence the ranking actually rests on.
      judgedSignalCount: spread.reduce((n, c) => n + c.hitRate.n, 0),
    });
  } catch (err) {
    console.error("Failed to build direction spread", err);
    res.status(500).json({ error: "Could not load the designer spread." });
  }
});

/**
 * Lock, or unlock, a brand's default director.
 *
 * `personaId: null` clears it, which returns the brand to letting the spread
 * rank for itself. `HOUSE_STYLE_ID` also clears it, because House style is the
 * absence of a director rather than a director you can store an id for.
 *
 * Writes `fieldProvenance.defaultPersonaId = "user"`. That is Principle 1.17 in
 * practice: this field was set by a person, so nothing automated may later treat
 * it as its own suggestion to revise.
 */
const DefaultPersonaBody = z.object({
  personaId: z.string().min(1).nullable(),
});

router.post(
  "/brands/:brandId/default-persona",
  requireStandardWrite,
  validateRequest({ body: DefaultPersonaBody }),
  async (req: Request, res: Response): Promise<void> => {
    const brandId = String(req.params.brandId);
    const { personaId } = req.body as z.infer<typeof DefaultPersonaBody>;

    // House style is the no-director case, so it stores as null.
    const nextPersonaId = personaId === HOUSE_STYLE_ID ? null : personaId;

    try {
      const [brand] = await db
        .select({ id: brandsTable.id, fieldProvenance: brandsTable.fieldProvenance })
        .from(brandsTable)
        .where(eq(brandsTable.id, brandId));
      if (!brand) {
        res.status(404).json({ error: "Brand not found" });
        return;
      }

      if (nextPersonaId !== null) {
        const [persona] = await db
          .select({ id: designerPersonasTable.id })
          .from(designerPersonasTable)
          .where(eq(designerPersonasTable.id, nextPersonaId));
        if (!persona) {
          res.status(400).json({ error: "That designer does not exist." });
          return;
        }
      }

      const [updated] = await db
        .update(brandsTable)
        .set({
          defaultPersonaId: nextPersonaId,
          fieldProvenance: { ...(brand.fieldProvenance ?? {}), defaultPersonaId: "user" },
          updatedAt: new Date(),
        })
        .where(eq(brandsTable.id, brandId))
        .returning({ id: brandsTable.id, defaultPersonaId: brandsTable.defaultPersonaId });

      await recordAudit({
        actor: actorFromRequest(req),
        action: nextPersonaId ? "brand.default_persona.set" : "brand.default_persona.clear",
        entityType: "brand",
        entityIds: [brandId],
        brandId,
        metadata: { defaultPersonaId: nextPersonaId },
      });

      res.json({ defaultPersonaId: updated?.defaultPersonaId ?? null });
    } catch (err) {
      console.error("Failed to set the default persona", err);
      res.status(500).json({ error: "Could not save the brand default." });
    }
  },
);

/**
 * The spread size stage 03 opens with.
 *
 * The 4-12 range is enforced here rather than as a database check constraint, so
 * an out-of-range value comes back as a readable 400 instead of a driver error.
 */
const SpreadSizeBody = z.object({
  defaultSpreadSize: z.number().int().min(4).max(12),
});

router.post(
  "/brands/:brandId/default-spread-size",
  requireStandardWrite,
  validateRequest({ body: SpreadSizeBody }),
  async (req: Request, res: Response): Promise<void> => {
    const brandId = String(req.params.brandId);
    const { defaultSpreadSize } = req.body as z.infer<typeof SpreadSizeBody>;

    try {
      const [brand] = await db
        .select({ id: brandsTable.id, fieldProvenance: brandsTable.fieldProvenance })
        .from(brandsTable)
        .where(eq(brandsTable.id, brandId));
      if (!brand) {
        res.status(404).json({ error: "Brand not found" });
        return;
      }

      const [updated] = await db
        .update(brandsTable)
        .set({
          defaultSpreadSize,
          fieldProvenance: { ...(brand.fieldProvenance ?? {}), defaultSpreadSize: "user" },
          updatedAt: new Date(),
        })
        .where(eq(brandsTable.id, brandId))
        .returning({ defaultSpreadSize: brandsTable.defaultSpreadSize });

      res.json({ defaultSpreadSize: updated?.defaultSpreadSize ?? defaultSpreadSize });
    } catch (err) {
      console.error("Failed to set the default spread size", err);
      res.status(500).json({ error: "Could not save the spread size." });
    }
  },
);

export default router;
