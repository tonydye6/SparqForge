/**
 * The entrance's two assists: POST /brief-improve and POST /brief-collab.
 *
 * Both are STATELESS and WRITE NOTHING. Improve returns one proposal beside
 * the untouched original; the collab returns the director's next message plus
 * the brief-so-far split into whose words are whose. The only thing that ever
 * persists a brief is the Start action, which goes through the existing
 * stage-takes endpoint like any other save.
 *
 * All prompt construction and response discipline lives in
 * services/brief-assist.ts, pure and with 20 assertions behind it.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, brandsTable, costLogsTable, designerPersonasTable } from "@workspace/db";
import { AI_MODELS, estimateClaudeTextCost } from "../lib/ai-config.js";
import { buildCostRow } from "../services/cost-recording.js";

/**
 * Every model call in this file writes a cost row. "Stateless and writes
 * nothing" (above) was true of the PRODUCT state and false of the money:
 * doc 39 §5.1 found the entire v2 text layer — improve, the director
 * conversation, intake, concepts — spending with no ledger rows at all,
 * in a product whose thesis is visible cost. Best effort: a failed cost
 * insert never fails the user's turn.
 */
async function recordAssistCost(operation: string, brandId: string, usage?: { input_tokens?: number; output_tokens?: number }) {
  try {
    await db.insert(costLogsTable).values(buildCostRow({
      service: "anthropic",
      operation,
      model: AI_MODELS.CLAUDE_SONNET,
      costUsd: estimateClaudeTextCost(),
      brandId,
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
    }));
  } catch (err) {
    console.error(`Cost row for ${operation} could not be written`, err);
  }
}
import { assistLimiter } from "../lib/rate-limit.js";
import { validateRequest } from "../middleware/validate.js";
import {
  buildCollabSystem,
  buildImprovePrompt,
  normalizeImprove,
  normalizeReply,
  toModelMessages,
  yoursFrom,
  type BrandContext,
  type CollabMessage,
  type DirectorVoice,
} from "../services/brief-assist.js";

const router: IRouter = Router();

async function loadBrand(brandId: string): Promise<BrandContext | null> {
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
  if (!brand) return null;
  return { name: brand.name, voiceDescription: brand.voiceDescription, bannedTerms: brand.bannedTerms };
}

function firstText(message: { content: Array<{ type: string; text?: string }> }): string {
  const block = message.content.find((b) => b.type === "text");
  return block?.text ?? "";
}

// ── improve ──────────────────────────────────────────────────────────────────

const ImproveBody = z.object({
  brandId: z.string().min(1),
  briefText: z.string().min(1).max(2000),
});

router.post(
  "/brief-improve",
  assistLimiter,
  validateRequest({ body: ImproveBody }),
  async (req: Request, res: Response): Promise<void> => {
    const { brandId, briefText } = req.body as z.infer<typeof ImproveBody>;
    const brand = await loadBrand(brandId);
    if (!brand) {
      res.status(404).json({ error: "That brand no longer exists." });
      return;
    }

    try {
      const message = await anthropic.messages.create({
        model: AI_MODELS.CLAUDE_SONNET,
        max_tokens: 300,
        messages: [{ role: "user", content: buildImprovePrompt(briefText, brand) }],
      });
      await recordAssistCost("brief_improve", brandId, message.usage);
      const improved = normalizeImprove(firstText(message));
      if (!improved) {
        res.status(502).json({ error: "No usable improvement came back. Try again." });
        return;
      }
      // The original travels back with the proposal, so the client never has
      // to trust its own state to keep the user's words safe.
      res.json({ original: briefText, proposal: improved.proposal });
    } catch (err) {
      console.error("Brief improve failed", err);
      res.status(502).json({ error: "The improvement could not be made. Your line is untouched." });
    }
  },
);

// ── the conversation ─────────────────────────────────────────────────────────

const CollabBody = z.object({
  brandId: z.string().min(1),
  /** Null leads with house style: a director card is never a requirement. */
  personaId: z.string().nullable().optional(),
  messages: z
    .array(z.object({ role: z.enum(["you", "director"]), text: z.string().max(2000) }))
    .min(1)
    .max(24),
});

router.post(
  "/brief-collab",
  assistLimiter,
  validateRequest({ body: CollabBody }),
  async (req: Request, res: Response): Promise<void> => {
    const { brandId, personaId, messages } = req.body as z.infer<typeof CollabBody>;
    const brand = await loadBrand(brandId);
    if (!brand) {
      res.status(404).json({ error: "That brand no longer exists." });
      return;
    }

    let voice: DirectorVoice = {
      id: "house",
      name: "House style",
      composition: "",
      mood: "",
      colorPhilosophy: "",
    };
    if (personaId && personaId !== "house") {
      const [persona] = await db
        .select()
        .from(designerPersonasTable)
        .where(eq(designerPersonasTable.id, personaId));
      if (!persona) {
        res.status(404).json({ error: "That director no longer exists." });
        return;
      }
      voice = {
        id: persona.id,
        name: persona.name,
        composition: persona.composition,
        mood: persona.mood,
        colorPhilosophy: persona.colorPhilosophy,
      };
    }

    const convo = messages as CollabMessage[];

    try {
      const message = await anthropic.messages.create({
        model: AI_MODELS.CLAUDE_SONNET,
        max_tokens: 700,
        system: buildCollabSystem(voice, brand),
        messages: toModelMessages(convo),
      });
      await recordAssistCost("brief_collab", brandId, message.usage);

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(firstText(message));
      } catch {
        // A non-JSON reply is still a director talking; keep the words, drop
        // the structure, rather than failing a working conversation.
        parsed = { message: firstText(message), chips: [], assumption: null, directors: "" };
      }

      const reply = normalizeReply(parsed);
      if (!reply) {
        res.status(502).json({ error: "The director went quiet. Say it again." });
        return;
      }

      res.json({
        reply,
        // Whose words are whose, computed server-side from the transcript so
        // the split the UI renders cannot drift from the contract.
        brief: { yours: yoursFrom(convo), directors: reply.directors },
        director: { id: voice.id, name: voice.name },
      });
    } catch (err) {
      console.error("Brief collab failed", err);
      res.status(502).json({ error: "The director could not answer. Nothing was lost." });
    }
  },
);

export default router;
