// src/jobs/queues.js

import { Queue, QueueEvents } from "bullmq";
import redis from "../config/redis.js";
import { logger } from "../utils/logger.js";

const defaultBullMQOptions = {
  connection: redis, // Use shared Redis connection
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
};

// Reuse the same Redis connection for all queues
const queues = {
  emailQueue: new Queue("emailQueue", defaultBullMQOptions),
  testimonialQueue: new Queue("testimonialQueue", defaultBullMQOptions),
  aiQueue: new Queue("aiQueue", defaultBullMQOptions),
  analyticsQueue: new Queue("analyticsQueue", defaultBullMQOptions),
  exportQueue: new Queue("exportQueue", defaultBullMQOptions),
  notificationQueue: new Queue("notificationQueue", defaultBullMQOptions),
};

// Initialize QueueEvents for each queue
const queueEvents = {};

Object.keys(queues).forEach((queueName) => {
  try {
    const queueEvent = new QueueEvents(queueName, { connection: redis });
    queueEvents[queueName] = queueEvent;

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

export default queues;
