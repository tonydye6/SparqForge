import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { ai as geminiAi } from "@workspace/integrations-gemini-ai";
import { COPILOT_MODELS } from "../lib/ai-config.js";
import { extractJSON } from "../lib/extract-json.js";
import { writeBuffer } from "../services/storage.js";
import { generationLimiter } from "../lib/rate-limit.js";
import {
  GUIDE_RESPONSE_SCHEMA,
  buildGuideSystemPrompt,
  parseGuideCandidates,
} from "../services/guide-extraction.js";
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
import {
  buildLearnedCandidates,
  applyCandidate,
  retireRule,
  activeRules,
  conclusionsFromIntentInsights,
  formatEvidence,
  type LearnedCandidate,
} from "../services/performance-learning.js";
import { getInsightsByIntent } from "../services/performance-insights.js";
import type { CompositionRule } from "@workspace/db";

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
          // The client formats and parses by kind. Omitting it would silently
          // make every field behave as text, which is the bug this whole pass
          // exists to fix.
          kind: f.spec.kind,
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

      /*
       * The value has to match the SHAPE of its column, not merely belong to a
       * field that exists. `bannedTerms` is a text[] and `hashtagStrategy` is
       * jsonb, so a client sending a plain string would corrupt them. The screen
       * converts before sending; this refuses anything that did not.
       */
      const specByKey = new Map(BRAND_FIELDS.map(f => [f.key, f]));
      for (const [key, value] of Object.entries(fields)) {
        const kind = specByKey.get(key)!.kind;
        const okShape =
          kind === "list" ? Array.isArray(value)
          : kind === "json" ? typeof value === "object" && value !== null && !Array.isArray(value)
          : typeof value === "string";
        if (!okShape) {
          res.status(400).json({
            error: `"${key}" is stored as ${kind === "list" ? "a list" : kind === "json" ? "a JSON object" : "text"}, and what arrived was not. Nothing was saved.`,
          });
          return;
        }
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

/**
 * Read a brand guide and PROPOSE what it says.
 *
 * Nothing is written to the record here. The response is candidates, each
 * carrying the sentence it came from, and accepting one is a separate PATCH that
 * stamps `source: "guide"`. That separation is the whole safeguard: an
 * extraction that wrote directly would be an automated suggestion becoming brand
 * law, which is the failure this record was built to prevent (§1.17).
 *
 * The PDF itself is stored and recorded on `brandGuideFileUrl`, so a field's
 * stated provenance can be traced back to a real document later.
 */
const guideUpload = multer({
  storage: multer.memoryStorage(),
  // The buffer goes to the model inline, so this is bounded by the request
  // limit rather than by disk. A guide over this is a conversation, not a crash.
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post(
  "/brands/:brandId/guide",
  requireStandardWrite,
  generationLimiter,
  guideUpload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const brandId = String(req.params.brandId);
    const file = (req as Request & { file?: Express.Multer.File }).file;

    try {
      if (!file) {
        res.status(400).json({ error: "No file arrived, so nothing was read." });
        return;
      }
      if (file.mimetype !== "application/pdf") {
        res.status(400).json({ error: "This reads PDFs. That file is not one, so nothing was read." });
        return;
      }

      const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
      if (!brand) {
        res.status(404).json({ error: "Brand not found" });
        return;
      }

      // Keep the document before reading it, so a field claiming to come from
      // the guide can be traced to the guide even if extraction later fails.
      const filename = `brand-guide-${brandId}-${Date.now()}.pdf`;
      const stored = await writeBuffer("brand-assets", filename, file.buffer);
      const fileUrl = `/api/files/brand-assets/${stored.filename}`;
      await db
        .update(brandsTable)
        .set({ brandGuideFileUrl: fileUrl, updatedAt: new Date() })
        .where(eq(brandsTable.id, brandId));

      const response = await geminiAi.models.generateContent({
        model: COPILOT_MODELS.ART_DIRECTION_MODEL,
        contents: [{
          role: "user",
          parts: [
            { inlineData: { data: file.buffer.toString("base64"), mimeType: "application/pdf" } },
            { text: `Read this brand guide for "${brand.name}" and propose only what it actually states.` },
          ],
        }],
        config: {
          systemInstruction: buildGuideSystemPrompt(),
          // gemini-3.5-flash is a thinking model and reasoning tokens count
          // against this budget. The Director learned that the expensive way.
          maxOutputTokens: 8192,
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: GUIDE_RESPONSE_SCHEMA,
        },
      });

      const provenance = (brand.fieldProvenance ?? {}) as Record<string, FieldSource>;
      const parsed = parseGuideCandidates(
        extractJSON<unknown>(response.text ?? ""),
        brand as unknown as Record<string, unknown>,
        provenance,
      );

      res.json({
        guideFileUrl: fileUrl,
        candidates: parsed.candidates,
        // Said out loud rather than hidden. A guide that yields three usable
        // lines out of nine is useful information about the guide.
        rejected: parsed.rejected,
      });
    } catch (err) {
      console.error("Failed to read the brand guide", err);
      res.status(500).json({
        error: "The guide could not be read. Nothing was written to the record.",
      });
    }
  },
);

/* ------------------------------------------------------------------------- *
 * Phase 5 · the third source: what performance taught this brand.
 *
 * Harvesting reads the asset library, extraction reads the guide PDF, and this
 * reads how the brand's published work actually did. All three follow the same
 * shape on purpose — propose, carry the evidence, let a human accept, stamp the
 * source — because that shape is what stops an automated suggestion becoming
 * brand law nobody chose (§1.17).
 *
 * Deriving conclusions is Phase 8's job. What lives here is the write-back: the
 * guards that decide whether a conclusion may be offered, and what accepting
 * one does to the record.
 * ------------------------------------------------------------------------- */

/** Rules as the screen shows them, newest decision first. */
function presentRules(rules: readonly CompositionRule[]) {
  return [...rules]
    .map((r, index) => ({
      index,
      rule: r.rule,
      source: r.source,
      n: r.n,
      confidence: r.confidence,
      appliedAt: r.appliedAt,
      retiredAt: r.retiredAt ?? null,
      conclusionId: r.conclusionId ?? null,
      evidenceLine: r.source === "learned"
        ? formatEvidence({ n: r.n, confidence: r.confidence, window: "tracked posts", effect: "applied to every generation" })
        : null,
    }))
    .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
}

router.get("/brands/:brandId/learned", async (req: Request, res: Response): Promise<void> => {
  const brandId = String(req.params.brandId);
  try {
    const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
    if (!brand) {
      res.status(404).json({ error: "Brand not found" });
      return;
    }

    const rules = (brand.compositionRules ?? []) as CompositionRule[];

    /*
     * A database aggregate over post_metrics. No model call, so this costs
     * nothing and can be read on every visit.
     */
    const insights = await getInsightsByIntent(brandId);
    const conclusions = conclusionsFromIntentInsights(insights);
    const { candidates, withheld } = buildLearnedCandidates(conclusions, rules);

    res.json({
      candidates,
      // Said out loud. "We found nothing" and "we found four things and none of
      // them had enough behind them" are different facts about the brand, and
      // only one of them means the derivation is working.
      withheld,
      rules: presentRules(rules),
      activeCount: activeRules(rules).length,
      // What the derivation had to work with, so an empty screen explains
      // itself rather than looking broken.
      trackedPosts: insights.reduce((n, i) => n + i.sampleSize, 0),
    });
  } catch (err) {
    console.error("Failed to read what performance taught this brand", err);
    res.status(500).json({ error: "The learned rules could not be read." });
  }
});

const RuleBody = z
  .object({
    /** Accept a derived candidate by id. */
    conclusionId: z.string().min(1).optional(),
    /** Or write one by hand, which is how this is usable before any data. */
    rule: z.string().min(1).max(400).optional(),
  })
  .refine(b => Boolean(b.conclusionId) !== Boolean(b.rule), {
    message: "Send either a conclusionId to accept, or a rule to write. Not both.",
  });

router.post(
  "/brands/:brandId/composition-rules",
  requireStandardWrite,
  validateRequest({ body: RuleBody }),
  async (req: Request, res: Response): Promise<void> => {
    const brandId = String(req.params.brandId);
    const { conclusionId, rule } = req.body as z.infer<typeof RuleBody>;

    try {
      const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
      if (!brand) {
        res.status(404).json({ error: "Brand not found" });
        return;
      }
      const rules = (brand.compositionRules ?? []) as CompositionRule[];
      const now = new Date();

      let candidate: LearnedCandidate;
      if (conclusionId) {
        /*
         * Re-derived server-side rather than taken from the request. A client
         * that could post arbitrary rule text alongside a conclusion id would
         * be able to attach any sentence it liked to a real sample size, which
         * is precisely the authority the evidence is supposed to confer.
         */
        const insights = await getInsightsByIntent(brandId);
        const { candidates } = buildLearnedCandidates(conclusionsFromIntentInsights(insights), rules);
        const found = candidates.find(c => c.conclusionId === conclusionId);
        if (!found) {
          res.status(409).json({
            error: "That conclusion is no longer being offered, so nothing was applied. The evidence may have moved, or it may already be on the record.",
          });
          return;
        }
        candidate = found;
      } else {
        // A hand-written rule. It gets a generated key so it can be retired
        // later without depending on its position in the array, and n = 0
        // because nobody should read a sample size into a human's decision.
        candidate = {
          conclusionId: `manual:${crypto.randomUUID()}`,
          kind: "composition",
          rule: rule!.trim(),
          because: "",
          evidence: { n: 0, confidence: 1, window: "", effect: "" },
          evidenceLine: "",
          overlapsApplied: null,
        };
      }

      const next = applyCandidate(rules, candidate, now);
      // A hand-written rule is the team's, not something learned. Only the
      // derived path may stamp `learned`, or the label stops meaning anything.
      if (!conclusionId) next[next.length - 1]!.source = "user";

      await db
        .update(brandsTable)
        .set({ compositionRules: next, updatedAt: now })
        .where(eq(brandsTable.id, brandId));

      res.json({ ok: true, rules: presentRules(next), activeCount: activeRules(next).length });
    } catch (err) {
      console.error("Failed to apply a composition rule", err);
      res.status(500).json({ error: "The rule could not be applied, so nothing was saved." });
    }
  },
);

/**
 * Retire an applied rule.
 *
 * Marks rather than deletes, so the record can say a rule was tried and
 * rejected, and so the same conclusion is not offered again on the next run.
 */
router.post(
  "/brands/:brandId/composition-rules/:conclusionId/retire",
  requireStandardWrite,
  async (req: Request, res: Response): Promise<void> => {
    const brandId = String(req.params.brandId);
    const conclusionId = String(req.params.conclusionId);

    try {
      const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
      if (!brand) {
        res.status(404).json({ error: "Brand not found" });
        return;
      }
      const rules = (brand.compositionRules ?? []) as CompositionRule[];
      const next = retireRule(rules, conclusionId, new Date());
      if (!next) {
        res.status(404).json({ error: "No rule with that id is on this record, so nothing changed." });
        return;
      }

      await db
        .update(brandsTable)
        .set({ compositionRules: next, updatedAt: new Date() })
        .where(eq(brandsTable.id, brandId));

      res.json({ ok: true, rules: presentRules(next), activeCount: activeRules(next).length });
    } catch (err) {
      console.error("Failed to retire a composition rule", err);
      res.status(500).json({ error: "The rule could not be retired, so nothing changed." });
    }
  },
);

export default router;
