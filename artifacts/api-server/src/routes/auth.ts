import { Router, type IRouter } from "express";
import passport from "../lib/passport";
import { isDevBypass, isGoogleConfigured } from "../middleware/auth";

const router: IRouter = Router();

function sanitizeReturnTo(returnTo: string | undefined): string {
  if (!returnTo) return "/";
  if (!returnTo.startsWith("/")) return "/";
  if (returnTo.startsWith("//")) return "/";
  if (returnTo.includes("://")) return "/";
  return returnTo;
}

router.get("/auth/me", (req, res): void => {
  if (req.user) {
    res.json({
      authenticated: true,
      user: req.user,
    });
    return;
  }
  res.json({ authenticated: false, user: null });
});

router.get("/auth/google", (req, res, next) => {
  if (isDevBypass()) {
    res.redirect("/");
    return;
  }

  if (!isGoogleConfigured()) {
    res.status(503).json({ error: "Google OAuth is not configured" });
    return;
  }

  const returnTo = sanitizeReturnTo(req.query.returnTo as string);
  (req.session as any).returnTo = returnTo;

  passport.authenticate("google", {
    scope: ["profile", "email"],
    state: true as any,
  })(req, res, next);
});

router.get(
  "/auth/google/callback",
  (req, res, next) => {
    if (!isGoogleConfigured()) {
      res.status(503).json({ error: "Google OAuth is not configured" });
      return;
    }
    passport.authenticate("google", { failureRedirect: "/login?error=auth_failed" })(req, res, next);
  },
  (req, res): void => {
    const returnTo = sanitizeReturnTo((req.session as any).returnTo);
    delete (req.session as any).returnTo;
    res.redirect(returnTo);
  },
);

router.post("/auth/logout", (req, res): void => {
  req.logout((err) => {
    if (err) {
      res.status(500).json({ error: "Logout failed" });
      return;
    }
    req.session.destroy((sessionErr) => {
      if (sessionErr) {
        res.status(500).json({ error: "Session destruction failed" });
        return;
      }
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });
});

export default router;
