import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

router.post("/feedback", (req, res) => {
  const { type, message, userEmail } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  const userId = (req.user as any)?.id || "anonymous";

  logger.info({
    feedbackType: type || "other",
    message: message.trim(),
    userId,
    userEmail: userEmail || null,
  }, "User feedback received");

  res.json({ success: true });
});

export default router;
