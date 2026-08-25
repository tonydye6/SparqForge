import type { Server } from "node:http";
import { directGeminiKeyNames, resolveDirectGeminiKey } from "@workspace/integrations-gemini-ai/api-key";
import app from "./app";
import { logger } from "./lib/logger";
import { seedDatabase } from "./seed";
import { cleanupDevBypassUser } from "./middleware/auth";
import {
  startTokenRefreshScheduler,
  stopTokenRefreshScheduler,
} from "./services/token-refresh";
import {
  startPublishScheduler,
  stopPublishScheduler,
} from "./services/publish-scheduler";
import {
  startMetricsScheduler,
  stopMetricsScheduler,
} from "./services/metrics-scheduler";
import {
  startConclusionsScheduler,
  stopConclusionsScheduler,
} from "./services/performance-conclusions-job";
import { logStorageStartupStatus } from "./services/storage";
import { syncAdminEmails } from "./services/admin-sync";
import { sweepStaleTurns } from "./services/stale-turn-sweep";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const SHUTDOWN_TIMEOUT_MS = 10_000;

function startServer(seedFailed: boolean): Server {
  const server = app.listen(port, () => {
    logger.info(
      { port },
      seedFailed ? "Server listening (seed failed)" : "Server listening",
    );
    logStorageStartupStatus();
    try {
      startPublishScheduler();
    } catch (err) {
      logger.error(err, "Publish scheduler failed to start — scheduling disabled");
    }
    try {
      startTokenRefreshScheduler();
    } catch (err) {
      logger.error(err, "Token refresh scheduler failed to start — tokens will not auto-refresh");
    }
    try {
      startMetricsScheduler();
    } catch (err) {
      logger.error(err, "Metrics scheduler failed to start — post analytics ingestion disabled");
    }
    try {
      startConclusionsScheduler();
    } catch (err) {
      logger.error(err, "Conclusions scheduler failed to start — Performance will show no new findings");
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error(
        { port },
        `Port ${port} is already in use — another process may be serving stale code. Exiting.`,
      );
    } else {
      logger.error(err, "HTTP server error — exiting");
    }
    process.exit(1);
  });

  return server;
}

function registerShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Received shutdown signal — closing server");

    const forceExit = setTimeout(() => {
      logger.error("Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    stopPublishScheduler();
    stopTokenRefreshScheduler();
    stopMetricsScheduler();
    stopConclusionsScheduler();

    server.close((err) => {
      if (err) {
        logger.error(err, "Error while closing HTTP server");
        clearTimeout(forceExit);
        process.exit(1);
        return;
      }
      logger.info("HTTP server closed — exiting cleanly");
      clearTimeout(forceExit);
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// C4: Mark any turns that were left in 'running' state (e.g. from a crashed
// process) as 'error' at startup.  Without this, they block the session
// turn-sequence check and can make the session appear permanently "busy".
// Turns cancelled in real time (AbortSignal) are stored as 'cancelled' and are
// deliberately NOT swept — the eq(status, 'running') filter exempts them.
// D4: Emit ONE prominent warning at startup when no direct Google AI key is set, so
// admins can act before the first failed user session.  The actual 503 guard
// lives in the sessions/:id/turns route.
function warnMissingGeminiKey(): void {
  // Reads every accepted spelling, not just GEMINI_API_KEY. The old check named
  // one variable, so a workspace that HAD the key under GOOGLE_AI_VISION_API_KEY
  // was warned it had none — and a workspace with the key genuinely missing got
  // a warning that named the only name someone would then fail to find in the
  // Secrets tab. See api-key.ts.
  const direct = resolveDirectGeminiKey();
  if (!direct) {
    logger.warn(
      `No direct Google AI key is set (looked for ${directGeminiKeyNames()}) — Co-pilot Studio ` +
      "(draft, edit, video, fan-out, caption, compare) will return 503 for every turn, and image " +
      "generation and layer edits will fail against the proxy. Set one and restart.",
    );
  } else {
    logger.info(`Direct Google AI key found in ${direct.varName}.`);
  }
}

seedDatabase()
  .then(async () => {
    warnMissingGeminiKey();
    await cleanupDevBypassUser();
    await syncAdminEmails();
    await sweepStaleTurns();
    const server = startServer(false);
    registerShutdownHandlers(server);
  })
  .catch(async (err) => {
    logger.error(err, "Failed to seed database");
    warnMissingGeminiKey();
    await cleanupDevBypassUser();
    await syncAdminEmails();
    await sweepStaleTurns();
    const server = startServer(true);
    registerShutdownHandlers(server);
  });
