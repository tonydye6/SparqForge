import app from "./app";
import { logger } from "./lib/logger";
import { seedDatabase } from "./seed";
import { refreshExpiringTokens } from "./services/token-refresh";
import { startPublishScheduler } from "./services/publish-scheduler";

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

seedDatabase()
  .then(() => {
    app.listen(port, () => {
      logger.info({ port }, "Server listening");
      try {
        startPublishScheduler();
      } catch (err) {
        logger.error(err, "Publish scheduler failed to start — scheduling disabled");
      }
    });
    refreshExpiringTokens()
      .then(() => logger.info("Token refresh check completed"))
      .catch((err) => logger.error(err, "Token refresh check failed"));
  })
  .catch((err) => {
    logger.error(err, "Failed to seed database");
    app.listen(port, () => {
      logger.info({ port }, "Server listening (seed failed)");
      try {
        startPublishScheduler();
      } catch (err) {
        logger.error(err, "Publish scheduler failed to start — scheduling disabled");
      }
    });
  });
