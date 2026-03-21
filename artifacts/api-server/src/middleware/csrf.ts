import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const CALLBACK_PATHS = [
  "/api/auth/google/callback",
  "/api/auth/twitter/callback",
  "/api/auth/instagram/callback",
  "/api/auth/linkedin/callback",
];

function getAllowedOrigins(): string[] {
  const origins: string[] = [];

  if (process.env.CORS_ORIGIN) {
    origins.push(...process.env.CORS_ORIGIN.split(",").map(o => o.trim()));
  }

  if (process.env.APP_URL) {
    origins.push(process.env.APP_URL);
  }

  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) {
    origins.push(`https://${devDomain}`);
  }

  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    for (const d of domains.split(",")) {
      const trimmed = d.trim();
      if (trimmed) origins.push(`https://${trimmed}`);
    }
  }

  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://localhost:5173", "http://localhost:19060");
  }

  return [...new Set(origins)];
}

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

  const allowed = getAllowedOrigins();

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

  if (req.session && (req.session as any).passport) {
    logger.warn({ path: req.path }, "CSRF check failed: session-authenticated request missing Origin/Referer");
    res.status(403).json({ error: "Forbidden: missing origin header" });
    return;
  }

  next();
}
