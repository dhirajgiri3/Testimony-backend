// src/jobs/worker.js

import emailWorker from "./workers/emailWorker.js";
import testimonialWorker from "./workers/testimonialWorker.js";
import aiWorker from "./workers/aiWorker.js";
import analyticsWorker from "./workers/analyticsWorker.js";
import exportWorker from "./workers/exportWorker.js";
import notificationWorker from "./workers/notificationWorker.js";
import { logger } from "../utils/logger.js";

// Array of all workers
const workers = [
  emailWorker,
  testimonialWorker,
  aiWorker,
  analyticsWorker,
  exportWorker,
  notificationWorker,
];

/**
 * Gracefully shutdown all workers
 */
const shutdownWorkers = async () => {
  logger.info("🛑 Shutting down all BullMQ workers...");
  try {
    await Promise.all(workers.map((worker) => worker.close()));
    logger.info("✅ All workers shut down successfully.");
    process.exit(0);
  } catch (error) {
    logger.error("❌ Error shutting down workers:", error);
    process.exit(1);
  }
};

// Listen for termination signals
process.on("SIGTERM", shutdownWorkers);
process.on("SIGINT", shutdownWorkers);

// Handle unexpected errors
workers.forEach((worker) => {
  worker.on("error", (error) => {
    logger.error(`❌ Worker ${worker.name} encountered an error:`, error);
  });
  worker.on("stalled", (job) => {
    logger.warn(`⚠️ Job ${job.id} in ${worker.name} is stalled.`);
  });
});

export { workers, shutdownWorkers };