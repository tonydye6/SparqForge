import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import path from "path";
import { sessionMiddleware } from "./lib/session";
import passport from "./lib/passport";
import { getAllowedOriginStrings } from "./lib/allowed-origins";
import { devBypassMiddleware, requireAuth } from "./middleware/auth";
import { csrfProtection } from "./middleware/csrf";
import authRouter from "./routes/auth";
import healthRouter from "./routes/health";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    const allowed = getAllowedOriginStrings();
    const isAllowed = allowed.some(a => a === origin) ||
      (process.env.NODE_ENV !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(origin));
    callback(null, isAllowed);
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many generation requests, please wait before trying again." },
});

app.use(globalLimiter);

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(csrfProtection);
app.use(devBypassMiddleware);

app.use("/api", healthRouter);
app.use("/api", authRouter);

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

const fileServingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many file requests, please try again later." },
});

app.get("/api/files/generated/:filename", fileServingLimiter, (req, res) => {
  const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filePath = path.join(UPLOAD_DIR, "generated", filename);
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).json({ error: "File not found" });
    }
  });
});

app.use("/api/campaigns/:id/generate", generationLimiter);
app.use("/api/campaigns/:id/generate-video", generationLimiter);
app.use("/api/campaigns/:id/variants/:variantId/audio", generationLimiter);
app.use("/api/campaigns/:id/variants/:variantId/audio-upload", generationLimiter);

app.use("/api", requireAuth, router);

app.all("/api/{*path}", (_req: Request, res: Response) => {
  res.status(404).json({ error: "API endpoint not found" });
});

export default app;
