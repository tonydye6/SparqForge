/**
 * Phase 8 items 3 and 4 · reading conclusions, and applying one.
 *
 * **Applying is the only place in this app where measured performance changes
 * what the next session proposes.** Doc 20 §2.9's argument is that a system
 * which quietly retrains on your numbers is one you cannot audit, so nothing
 * here happens on a timer: the job proposes, a person decides, and the row
 * records who decided and when.
 *
 * The write each kind performs was recorded on the row BEFORE anyone pressed
 * anything, by the derivation. This handler executes that stored offer rather
 * than recomputing one, so the card and the consequence cannot diverge — the
 * screen shows exactly what is about to change.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  brandScheduleProfilesTable,
  brandsTable,
  designerPersonasTable,
  performanceConclusionsTable,
  type CompositionRule,
  type PerformanceConclusion,
} from "@workspace/db";
import { str } from "../lib/http-params.js";
import { requireStandardWrite } from "../middleware/auth.js";
import { actorFromRequest, recordAudit } from "../lib/audit.js";
import { deriveAndStoreForBrand } from "../services/performance-conclusions-job.js";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Every day of the week. A day-part finding says nothing about which day. */
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// GET /brands/:brandId/conclusions — proposed first, then the decided history.
router.get("/brands/:brandId/conclusions", async (req: Request, res: Response): Promise<void> => {
  const brandId = str(req.params.brandId);
  const rows = await db
    .select()
    .from(performanceConclusionsTable)
    .where(eq(performanceConclusionsTable.brandId, brandId))
    .orderBy(performanceConclusionsTable.createdAt);

  const proposed = rows.filter(r => r.status === "proposed");
  const decided = rows.filter(r => r.status !== "proposed");
  res.json({
    // Strongest evidence first: the one most worth attention rests on the most
    // posts, not the one the job happened to write first.
    proposed: proposed.sort((a, b) => evidenceN(b) - evidenceN(a)),
    decided: decided.reverse(),
  });
});

function evidenceN(row: PerformanceConclusion): number {
  const n = (row.evidence as { n?: unknown } | null)?.n;
  return typeof n === "number" ? n : 0;
}

/**
 * POST /brands/:brandId/conclusions/refresh — derive now rather than on the hour.
 *
 * Free: no model call, one read of posts already in the database. It exists so
 * the surface is not a screen you have to wait an hour to see working.
 */
router.post(
  "/brands/:brandId/conclusions/refresh",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const brandId = str(req.params.brandId);
    const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
    if (!brand) {
      res.status(404).json({ error: "Brand not found" });
      return;
    }
    const result = await deriveAndStoreForBrand(brandId);
    res.json(result);
  },
);

/**
 * Perform the write a conclusion offered.
 *
 * Returns a sentence describing what changed, which becomes the confirmation
 * the user reads. An unknown target is a 400 rather than a silent success: a
 * conclusion whose write nobody implemented must not be marked applied, because
 * the row would then claim an effect that never happened.
 */
async function performWrite(
  row: PerformanceConclusion,
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const applies = row.appliesTo as { table?: string; field?: string; value?: unknown } | null;
  if (!applies || typeof applies.table !== "string" || typeof applies.field !== "string") {
    return { ok: false, error: "This conclusion has nothing to apply." };
  }

  if (applies.table === "brand_schedule_profiles" && applies.field === "status") {
    const v = applies.value as {
      platform?: string; hours?: number[]; status?: string; score?: number; dayPart?: string;
    };
    if (typeof v?.platform !== "string" || !Array.isArray(v.hours) || v.hours.length === 0) {
      return { ok: false, error: "The stored write is missing its platform or hours." };
    }
    const status = typeof v.status === "string" ? v.status : "preferred";
    const score = typeof v.score === "number" ? v.score : 0.9;

    let written = 0;
    for (const day of ALL_DAYS) {
      for (const hour of v.hours) {
        const [existing] = await db
          .select({ id: brandScheduleProfilesTable.id })
          .from(brandScheduleProfilesTable)
          .where(and(
            eq(brandScheduleProfilesTable.brandId, row.brandId),
            eq(brandScheduleProfilesTable.platform, v.platform),
            eq(brandScheduleProfilesTable.dayOfWeek, day),
            eq(brandScheduleProfilesTable.hour, hour),
          ));
        if (existing) {
          await db.update(brandScheduleProfilesTable)
            .set({ score, status, updatedAt: new Date() })
            .where(eq(brandScheduleProfilesTable.id, existing.id));
        } else {
          await db.insert(brandScheduleProfilesTable).values({
            brandId: row.brandId, platform: v.platform, dayOfWeek: day, hour, score, status,
          });
        }
        written += 1;
      }
    }
    return {
      ok: true,
      summary: `Marked ${written} ${v.platform} slots as ${status}, every day from ` +
        `${String(v.hours[0]).padStart(2, "0")}:00.`,
    };
  }

  if (applies.table === "brands" && applies.field === "defaultPersonaId") {
    const personaId = applies.value;
    if (typeof personaId !== "string") {
      return { ok: false, error: "The stored write does not name a director." };
    }
    // The persona can have been deleted between derivation and Apply. Setting a
    // dangling default would break stage 02 rather than improve it.
    const [persona] = await db.select({ id: designerPersonasTable.id, name: designerPersonasTable.name })
      .from(designerPersonasTable).where(eq(designerPersonasTable.id, personaId));
    if (!persona) {
      return { ok: false, error: "That director no longer exists, so it cannot become the default." };
    }
    const [current] = await db.select({ fieldProvenance: brandsTable.fieldProvenance })
      .from(brandsTable).where(eq(brandsTable.id, row.brandId));
    /*
     * STAMPED `learned`, where `POST /direction` stamps the same field `user`.
     * The brand record labels every field by where its value came from, and a
     * default director chosen off published numbers is not one somebody picked
     * — §1.17. This is the opposite call to the one `performance-learning.ts`
     * makes for `compositionRules`, and deliberately so: that field is an array
     * holding rules from three different sources, so one field-level word could
     * never be true of it. `defaultPersonaId` holds exactly one value with
     * exactly one origin.
     */
    await db.update(brandsTable)
      .set({
        defaultPersonaId: personaId,
        fieldProvenance: { ...(current?.fieldProvenance ?? {}), defaultPersonaId: "learned" },
        updatedAt: new Date(),
      })
      .where(eq(brandsTable.id, row.brandId));
    return { ok: true, summary: `${persona.name} is now this brand's default director.` };
  }

  if (applies.table === "brands" && applies.field === "compositionRules") {
    const rule = (applies.value as { rule?: unknown } | null)?.rule;
    if (typeof rule !== "string" || rule.trim().length === 0) {
      return { ok: false, error: "The stored write has no rule text." };
    }
    const [brand] = await db.select({ compositionRules: brandsTable.compositionRules })
      .from(brandsTable).where(eq(brandsTable.id, row.brandId));
    if (!brand) return { ok: false, error: "Brand not found." };

    const existing = (brand.compositionRules ?? []) as CompositionRule[];
    // Already there: applying twice must not double the rule in the contract.
    if (existing.some(r => r.conclusionId === row.conclusionKey && !r.retiredAt)) {
      return { ok: true, summary: "That rule was already in the brand contract." };
    }
    /*
     * `conclusionId` carries the conclusion's stable KEY, not its row id. The
     * key is what survives a re-derivation, and it is what stops a rule someone
     * retired from being offered again by the next pass.
     */
    const appended: CompositionRule = {
      rule: rule.trim(),
      source: "learned",
      n: evidenceN(row),
      confidence: confidenceAsNumber(row.confidence),
      appliedAt: new Date().toISOString(),
      conclusionId: row.conclusionKey,
    };
    await db.update(brandsTable)
      .set({ compositionRules: [...existing, appended], updatedAt: new Date() })
      .where(eq(brandsTable.id, row.brandId));
    return { ok: true, summary: "Added to this brand's composition rules, and every generation now reads it." };
  }

  return { ok: false, error: `Nothing here knows how to write ${applies.table}.${applies.field}.` };
}

/**
 * The enum, as the fraction `CompositionRule.confidence` stores.
 *
 * Lossy on purpose and in one direction only: the rule's own `n` travels with
 * it into the prompt, so the number that actually weights the instruction is
 * the sample size rather than this.
 */
function confidenceAsNumber(confidence: string): number {
  if (confidence === "high") return 0.9;
  if (confidence === "medium") return 0.6;
  return 0.3;
}

// POST /conclusions/:id/apply — perform the stored write, then record who did it.
router.post(
  "/conclusions/:id/apply",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const [row] = await db.select().from(performanceConclusionsTable)
      .where(eq(performanceConclusionsTable.id, id));
    if (!row) {
      res.status(404).json({ error: "Conclusion not found" });
      return;
    }
    if (row.status !== "proposed") {
      res.status(409).json({ error: `This conclusion was already ${row.status}.` });
      return;
    }

    const result = await performWrite(row);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    /*
     * The status moves only AFTER the write succeeded. If the order were
     * reversed, a failed write would leave a row claiming an effect the brand
     * record never received — the audit trail asserting something untrue is
     * strictly worse than no audit trail.
     */
    const actor = actorFromRequest(req);
    await db.update(performanceConclusionsTable)
      .set({
        status: "applied",
        appliedAt: new Date(),
        appliedBy: actor.id === "unknown" ? null : actor.id,
      })
      .where(eq(performanceConclusionsTable.id, id));

    await recordAudit({
      actor,
      action: "conclusion.apply",
      entityType: "performance_conclusion",
      entityIds: [id],
      brandId: row.brandId,
      metadata: { kind: row.kind, conclusionKey: row.conclusionKey, wrote: row.appliesTo, summary: result.summary },
    });
    logger.info({ id, kind: row.kind, brandId: row.brandId }, "Performance conclusion applied");

    res.json({ status: "applied", summary: result.summary });
  },
);

// POST /conclusions/:id/dismiss — and it stays dismissed, run after run.
router.post(
  "/conclusions/:id/dismiss",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const id = str(req.params.id);
    const [row] = await db.select().from(performanceConclusionsTable)
      .where(eq(performanceConclusionsTable.id, id));
    if (!row) {
      res.status(404).json({ error: "Conclusion not found" });
      return;
    }
    if (row.status !== "proposed") {
      res.status(409).json({ error: `This conclusion was already ${row.status}.` });
      return;
    }

    await db.update(performanceConclusionsTable)
      .set({ status: "dismissed", dismissedAt: new Date() })
      .where(eq(performanceConclusionsTable.id, id));

    await recordAudit({
      actor: actorFromRequest(req),
      action: "conclusion.dismiss",
      entityType: "performance_conclusion",
      entityIds: [id],
      brandId: row.brandId,
      metadata: { kind: row.kind, conclusionKey: row.conclusionKey },
    });

    res.json({ status: "dismissed" });
  },
);

export default router;
