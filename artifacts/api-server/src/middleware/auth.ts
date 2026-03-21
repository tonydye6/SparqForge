import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const DEV_USER = {
  id: "dev-user-00000000-0000-0000-0000-000000000000",
  email: "dev@sparqforge.local",
  name: "Dev User",
  image: null,
  role: "editor",
};

let devUserEnsured = false;

async function ensureDevUser() {
  if (devUserEnsured) return;
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, DEV_USER.id));
    if (!existing) {
      await db.insert(usersTable).values({
        id: DEV_USER.id,
        email: DEV_USER.email,
        name: DEV_USER.name,
        image: DEV_USER.image,
        role: DEV_USER.role,
      });
      logger.info("Dev bypass user created");
    }
    devUserEnsured = true;
  } catch (err) {
    logger.error(err, "Failed to ensure dev user");
  }
}

export function isDevBypass(): boolean {
  return process.env.DEV_AUTH_BYPASS === "true";
}

export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function devBypassMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!isDevBypass()) {
    next();
    return;
  }

  ensureDevUser().then(() => {
    (req as any).user = DEV_USER;
    next();
  }).catch(next);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isDevBypass()) {
    next();
    return;
  }

  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    next();
    return;
  }

  res.status(401).json({ error: "Authentication required" });
}
