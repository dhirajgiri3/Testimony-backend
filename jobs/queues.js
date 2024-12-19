// src/jobs/queues.js

import { Queue, QueueEvents } from "bullmq";
import { redis } from "../config/redis.js"; // Use the singleton Redis client
import { logger } from "../utils/logger.js";

// Initialize queues
export const queues = {
  emailQueue: new Queue("emailQueue", { connection: redis }),
  testimonialQueue: new Queue("testimonialQueue", { connection: redis }),
  aiQueue: new Queue("aiQueue", { connection: redis }),
  analyticsQueue: new Queue("analyticsQueue", { connection: redis }),
  exportQueue: new Queue("exportQueue", { connection: redis }),
  notificationQueue: new Queue("notificationQueue", { connection: redis }),
};

// Initialize queue events
Object.keys(queues).forEach((queueName) => {
  try {
    const queueEvent = new QueueEvents(queueName, { connection: redis });
    queues[`${queueName}Events`] = queueEvent;

    queueEvent.on("completed", ({ jobId }) => {
      logger.info(
        `✅ Job ${jobId} in queue ${queueName} completed successfully.`
      );
    });

    queueEvent.on("failed", ({ jobId, failedReason }) => {
      logger.error(
        `❌ Job ${jobId} in queue ${queueName} failed. Reason: ${failedReason}`
      );
    });

    queueEvent.on("stalled", ({ jobId }) => {
      logger.warn(`⚠️ Job ${jobId} in queue ${queueName} has stalled.`);
    });

    queueEvent.on("progress", ({ jobId, data }) => {
      logger.info(`📈 Job ${jobId} in queue ${queueName} progress:`, data);
    });

    logger.info(
      `✅ Queue and QueueEvents for ${queueName} initialized successfully`
    );
  } catch (error) {
    logger.error(
      `❌ Failed to initialize Queue and QueueEvents for ${queueName}:`,
      error
    );
  }
});
