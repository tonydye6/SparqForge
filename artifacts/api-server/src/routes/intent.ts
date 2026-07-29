import { Router, type IRouter, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, brandsTable, socialAccountsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { AI_MODELS } from "../lib/ai-config.js";
import { validateRequest } from "../middleware/validate.js";
import { generationLimiter } from "../lib/rate-limit.js";
import { extractJSON } from "../lib/extract-json.js";
import { INTENTS, INTENT_LABELS, INTENT_DESCRIPTIONS, isIntent, intentPromptCatalog, type Intent } from "../lib/intents.js";
import {
  buildDerivedRows,
  deriveChannels,
  deriveMustNot,
  normalizeQuestions,
  MAX_QUESTIONS,
  type DerivedRow,
} from "../services/brief-intake.js";

// Goal-aware posting: infer the strategic intent behind a brief with Claude.
// Returns the top intent with a confidence plus ranked alternates, which the
// Studio surfaces as a one-tap confirm/adjust chip.
const InferIntentBody = z.object({
  briefText: z.string().min(1).max(4000),
  brandId: z.string().min(1).optional(),
});

const InferenceSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  alternates: z
    .array(z.object({ intent: z.enum(INTENTS), confidence: z.number().min(0).max(1) }))
    .max(3)
    .default([]),
  reasoning: z.string().max(500).optional(),
});

export type IntentInference = z.infer<typeof InferenceSchema>;

const router: IRouter = Router();

// GET the taxonomy so clients render labels from one source of truth.
router.get("/intents", (_req: Request, res: Response): void => {
  res.json({
    intents: INTENTS.map(i => ({ id: i, label: INTENT_LABELS[i], description: INTENT_DESCRIPTIONS[i] })),
  });
});

router.post(
  "/intent-inference",
  generationLimiter,
  validateRequest({ body: InferIntentBody }),
  async (req: Request, res: Response): Promise<void> => {
    const { briefText, brandId } = req.body as z.infer<typeof InferIntentBody>;

    let brandLine = "";
    if (brandId) {
      const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
      if (brand) brandLine = `\nThe brand: ${brand.name}.${brand.voiceDescription ? ` Voice: ${brand.voiceDescription}` : ""}`;
    }

    try {
      const message = await anthropic.messages.create({
        model: AI_MODELS.CLAUDE_SONNET,
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: `You classify the strategic goal (intent) of a social media post brief. The intent taxonomy:

${intentPromptCatalog()}
${brandLine}

The creator's brief: "${briefText.trim()}"

Pick the single best-fit intent, a confidence between 0 and 1, and up to 2 ranked alternates (only intents that are genuinely plausible). One short sentence of reasoning.

Respond with ONLY JSON: {"intent": string, "confidence": number, "alternates": [{"intent": string, "confidence": number}], "reasoning": string}. No markdown, no code fence.`,
          },
        ],
      });

      const raw = message.content[0]?.type === "text" ? message.content[0].text : "";
      const parsed = InferenceSchema.safeParse(extractJSON(raw));
      if (!parsed.success || !isIntent(parsed.data.intent)) {
        res.status(502).json({ error: "Could not infer an intent. Please try again." });
        return;
      }

      const { intent, confidence, alternates, reasoning } = parsed.data;
      res.json({
        intent,
        label: INTENT_LABELS[intent as Intent],
        confidence,
        alternates: alternates
          .filter(a => a.intent !== intent)
          .map(a => ({ ...a, label: INTENT_LABELS[a.intent as Intent] })),
        reasoning: reasoning ?? null,
      });
    } catch {
      res.status(500).json({ error: "Intent inference failed. Please try again." });
    }
  },
);

// ---------------------------------------------------------------------------
// Stage 01 · Brief intake.
//
// Studio v2's Brief stage needs more than the intent: it renders the whole
// "What I derived from that" panel plus the short interview beside it. This
// endpoint is that panel's data in one round trip.
//
// It is deliberately SEPARATE from /intent-inference rather than an extension
// of it. StudioNext is the sole caller of that endpoint and is legacy code we
// are not touching; widening its response to carry questions would put a live
// surface at risk for no gain here.
//
// The response is degradable by design. Channels and Must-not come off the
// brand record and the connected accounts, so they are returned even when the
// model call fails. A brief must never be blocked by an inference (§1.11), and
// the brand facts were never the model's to know.
// ---------------------------------------------------------------------------

const BriefIntakeBody = z.object({
  briefText: z.string().min(1).max(4000),
  brandId: z.string().min(1).optional(),
});

const IntakeSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  alternates: z
    .array(z.object({ intent: z.enum(INTENTS), confidence: z.number().min(0).max(1) }))
    .max(3)
    .default([]),
  reasoning: z.string().max(500).optional(),
  // Shape only. The mandatory-assumption rule is enforced in
  // normalizeQuestions, not here, so a prompt regression cannot smuggle a
  // question through without a stated default.
  questions: z.array(z.unknown()).max(8).default([]),
});

router.post(
  "/brief-intake",
  generationLimiter,
  validateRequest({ body: BriefIntakeBody }),
  async (req: Request, res: Response): Promise<void> => {
    const { briefText, brandId } = req.body as z.infer<typeof BriefIntakeBody>;

    // Brand-sourced facts first, so they survive a model failure.
    let brandLine = "";
    let brandConstraints: {
      bannedTerms?: string[] | null;
      negativePrompt?: string | null;
      trademarkRules?: string | null;
    } = {};
    let connectedPlatforms: string[] = [];

    if (brandId) {
      const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
      if (brand) {
        brandLine = `\nThe brand: ${brand.name}.${brand.voiceDescription ? ` Voice: ${brand.voiceDescription}` : ""}`;
        brandConstraints = {
          bannedTerms: brand.bannedTerms,
          negativePrompt: brand.negativePrompt,
          trademarkRules: brand.trademarkRules,
        };
      }
      const accounts = await db
        .select({ platform: socialAccountsTable.platform })
        .from(socialAccountsTable)
        .where(and(eq(socialAccountsTable.brandId, brandId), eq(socialAccountsTable.status, "connected")));
      connectedPlatforms = accounts.map(a => a.platform);
    }

    /** What we can still say with no model at all. */
    const brandOnlyRows = (): DerivedRow[] => {
      const rows: DerivedRow[] = [deriveChannels(connectedPlatforms)];
      const mustNot = deriveMustNot(brandConstraints);
      if (mustNot) rows.push(mustNot);
      return rows;
    };

    try {
      const message = await anthropic.messages.create({
        model: AI_MODELS.CLAUDE_SONNET,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `You are reading a social media post brief written by a games marketer. Do two jobs.

JOB 1. Classify the strategic goal (intent). The taxonomy:

${intentPromptCatalog()}

JOB 2. Write up to ${MAX_QUESTIONS} questions worth asking about this brief.

Rules for the questions, all mandatory:
- Ask ONLY about something that would visibly change the finished post. If knowing the answer would not change the image or the words, do not ask it.
- Never ask for anything already stated or clearly implied in the brief.
- Never ask which platform or channel to post on. That is known from the brand record.
- Each question needs 2 to 4 short concrete options.
- Each question MUST include "assumption": what you will assume if the question is ignored, written as a sentence fragment continuing "Skip and I assume ...". A question without a real assumption will be discarded, so write one you would genuinely act on.
- Fewer, sharper questions beat more. Zero is a valid answer if the brief is already clear.
${brandLine}

The creator's brief: "${briefText.trim()}"

Respond with ONLY JSON, no markdown and no code fence:
{"intent": string, "confidence": number, "alternates": [{"intent": string, "confidence": number}], "reasoning": string, "questions": [{"id": string, "question": string, "options": [string], "assumption": string}]}`,
          },
        ],
      });

      const raw = message.content[0]?.type === "text" ? message.content[0].text : "";
      const parsed = IntakeSchema.safeParse(extractJSON(raw));

      if (!parsed.success || !isIntent(parsed.data.intent)) {
        // Degrade rather than 502: the brand rows are still true.
        res.json({
          intent: null,
          derived: brandOnlyRows(),
          questions: [],
          degraded: true,
          degradedReason: "The goal could not be inferred, so only the brand record is shown.",
        });
        return;
      }

      const { intent, confidence, alternates, reasoning, questions } = parsed.data;
      const ranked = alternates.filter(a => a.intent !== intent);
      const runnerUp = ranked.length > 0 ? ranked[0] : null;

      res.json({
        intent: {
          id: intent,
          label: INTENT_LABELS[intent as Intent],
          confidence,
          reasoning: reasoning ?? null,
          alternates: ranked.map(a => ({ ...a, label: INTENT_LABELS[a.intent as Intent] })),
        },
        derived: buildDerivedRows({
          intent: intent as Intent,
          confidence,
          runnerUp: runnerUp as { intent: Intent; confidence: number } | null,
          connectedPlatforms,
          brand: brandConstraints,
        }),
        questions: normalizeQuestions(questions),
        degraded: false,
      });
    } catch {
      res.json({
        intent: null,
        derived: brandOnlyRows(),
        questions: [],
        degraded: true,
        degradedReason: "The goal could not be inferred, so only the brand record is shown.",
      });
    }
  },
);

export default router;
