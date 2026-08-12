import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, Response } from "express";

/**
 * Per-user keying, shared by every limiter here: two people testing at once must
 * not throttle each other, which an IP key would do behind a single office NAT.
 */
function perUser(req: Request, res: Response): string {
  const userId = (req.user as Express.User | undefined)?.id;
  return userId
    ? `user:${userId}`
    : `ip:${ipKeyGenerator(req.ip ?? "", res as unknown as Parameters<typeof ipKeyGenerator>[1])}`;
}

/**
 * The MONEY limiter: anything that renders an image or a video.
 *
 * Five a minute is a deliberate brake on spend, not on interaction — one press
 * here can be a spread of eight images.
 */
export const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUser,
  message: { error: "Too many generation requests, please wait before trying again." },
});

/**
 * The CONVERSATION limiter: assistants, concept suggestions, rewrites — the
 * cheap text calls a person makes while thinking.
 *
 * Split out after Daniel's first test of the published app, where he hit "Too
 * many generation requests" twice on the Spark stage without generating a single
 * image. Every one of those calls was sharing the five-a-minute IMAGE budget, so
 * a couple of chat turns plus a concept re-roll exhausted it — the limiter was
 * refusing the one surface a new user touches first, and doing it in the
 * language of generation, which reads as though the app had tried to spend money.
 *
 * These are Gemini TEXT calls at roughly $0.004 apiece, so the ceiling is set by
 * what a person can actually type rather than by cost. It is still a real limit:
 * a runaway client loop is caught, just not a human in a hurry.
 */
export const assistLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUser,
  message: { error: "That was a lot of requests in a row — give it a few seconds and try again." },
});
