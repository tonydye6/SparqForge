import app from "./app";
import { logger } from "./lib/logger";
import { seedDatabase } from "./seed";

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
    });
  })
  .catch((err) => {
    logger.error(err, "Failed to seed database");
    app.listen(port, () => {
      logger.info({ port }, "Server listening (seed failed)");
    });
  });
