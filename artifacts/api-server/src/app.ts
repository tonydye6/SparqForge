import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { sessionMiddleware } from "./lib/session";
import passport from "./lib/passport";
import { devBypassMiddleware, requireAuth } from "./middleware/auth";
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
  origin: true,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(devBypassMiddleware);

app.use("/api", healthRouter);
app.use("/api", authRouter);
app.use("/api", requireAuth, router);

export default app;
