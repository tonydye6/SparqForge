import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { sessionMiddleware } from "./lib/session";
import passport from "./lib/passport";
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

function getAllowedOrigins(): (string | RegExp)[] {
  const origins: (string | RegExp)[] = [];

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
    origins.push(/^https?:\/\/localhost(:\d+)?$/);
  }

  return origins;
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    const allowed = getAllowedOrigins();
    const isAllowed = allowed.some(a => {
      if (a instanceof RegExp) return a.test(origin);
      return a === origin;
    });
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(null, false);
    }
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
app.use(csrfProtection);

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(devBypassMiddleware);

app.use("/api", healthRouter);
app.use("/api", authRouter);

app.use("/api/campaigns/:id/generate", generationLimiter);
app.use("/api/campaigns/:id/generate-video", generationLimiter);

app.use("/api", requireAuth, router);

app.all("/api/{*path}", (_req: Request, res: Response) => {
  res.status(404).json({ error: "API endpoint not found" });
});

export default app;
