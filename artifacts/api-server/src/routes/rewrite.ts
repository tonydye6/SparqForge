import { Router, type IRouter, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { AI_MODELS } from "../lib/ai-config.js";

const router: IRouter = Router();

router.post("/rewrite", async (req: Request, res: Response): Promise<void> => {
  const { text, instruction } = req.body;

  if (!text || !instruction) {
    res.status(400).json({ error: "Both text and instruction are required" });
    return;
  }

  if (typeof text !== "string" || typeof instruction !== "string") {
    res.status(400).json({ error: "Invalid input types" });
    return;
  }

  if (text.length > 5000 || instruction.length > 500) {
    res.status(400).json({ error: "Input too long" });
    return;
  }

  try {
    const message = await anthropic.messages.create({
      model: AI_MODELS.CLAUDE_SONNET,
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `You are rewriting a portion of social media caption text. Apply the user's instruction to transform the selected text.

SELECTED TEXT: "${text}"
INSTRUCTION: "${instruction}"

Respond with ONLY the rewritten text. No quotes, no explanation, no preamble. Just the rewritten text.`,
        },
      ],
    });

    const rewritten = message.content[0].type === "text" ? message.content[0].text.trim() : text;

    res.json({ rewritten });
  } catch {
    res.status(500).json({ error: "Rewrite failed. Please try again." });
  }
});

export default router;
