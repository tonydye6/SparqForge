import type { Request, Response, NextFunction } from "express";
import { getAllowedOriginStrings } from "../lib/allowed-origins";
import { logger } from "../lib/logger";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const CALLBACK_PATHS = [
  "/api/auth/google/callback",
  "/api/auth/twitter/callback",
  "/api/auth/instagram/callback",
  "/api/auth/linkedin/callback",
];

function isOriginAllowed(originOrReferer: string, allowed: string[]): boolean {
  try {
    const parsed = new URL(originOrReferer);
    const origin = parsed.origin;
    return allowed.some(a => origin === a);
  } catch {
    return false;
  }
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next();
    return;
  }

  if (CALLBACK_PATHS.some(p => req.path.startsWith(p))) {
    next();
    return;
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  const allowed = getAllowedOriginStrings();

  if (origin) {
    if (isOriginAllowed(origin, allowed)) {
      next();
      return;
    }
    logger.warn({ origin, path: req.path }, "CSRF check failed: origin not allowed");
    res.status(403).json({ error: "Forbidden: origin not allowed" });
    return;
  }

  if (referer) {
    if (isOriginAllowed(referer, allowed)) {
      next();
      return;
    }
    logger.warn({ referer, path: req.path }, "CSRF check failed: referer not allowed");
    res.status(403).json({ error: "Forbidden: origin not allowed" });
    return;
  }

  if (req.isAuthenticated && req.isAuthenticated()) {
    logger.warn({ path: req.path }, "CSRF check failed: authenticated request missing Origin/Referer");
    res.status(403).json({ error: "Forbidden: missing origin header" });
    return;
  }

  next();
}
