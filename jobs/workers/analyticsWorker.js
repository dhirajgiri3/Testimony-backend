// src/jobs/workers/analyticsWorker.js

import { Worker } from "bullmq";
import { updateAnalytics } from "../../services/analyticsService.js";
import { logger } from "../../utils/logger.js";
import {redis} from "../../config/redis.js";
import {queues} from "../queues.js";

// Constants for worker configuration
const WORKER_CONFIG = {
  connection: redis,
  concurrency: 3,
  maxStalledCount: 3,
  stalledInterval: 30000, // 30 seconds
  lockDuration: 60000, // 1 minute
  removeOnComplete: {
    count: 1000,
    age: 24 * 3600 // 24 hours
  },
  removeOnFail: {
    count: 500,
    age: 7 * 24 * 3600 // 7 days
  },
  metrics: {
    maxDataPoints: 24 * 7 // Store metrics for 7 days
  }
};

const analyticsWorker = new Worker(
  "analyticsQueue",
  async (job) => {
    const { seekerId, priority = "normal" } = job.data;

    if (!seekerId) {
      throw new Error(`Invalid job data. Missing 'seekerId' for job ${job.id}`);
    }

    try {
      // Update job progress
      await job.updateProgress(10);

      // Perform analytics update
      const result = await updateAnalytics(seekerId);
      await job.updateProgress(50);

      // If high priority, trigger immediate recommendations update
      if (priority === "high") {
        await queues.recommendationQueue.add(
          "updateRecommendations",
          { seekerId },
          { priority: 2 }
        );
      }

      await job.updateProgress(100);
      
      return { success: true, seekerId, result };

    } catch (error) {
      logger.error(
        `❌ Error processing analytics job ${job.id}: ${error.message}`,
        {
          jobId: job.id,
          seekerId,
          error: error.stack
        }
      );

      // Notify admin for critical errors
      if (job.attemptsMade >= 2) {
        await queues.notificationQueue.add(
          "sendAdminAlert",
          {
            type: "ANALYTICS_FAILURE",
            jobId: job.id,
            seekerId,
            error: error.message
          },
          { priority: 1 }
        );
      }

      throw error;
    }
  },
  WORKER_CONFIG
);

// Enhanced Event Listeners
analyticsWorker
  .on("completed", (job, result) => {
    logger.info(`✅ Analytics job ${job.id} completed successfully.`, {
      jobId: job.id,
      seekerId: job.data.seekerId,
      result
    });
  })
  .on("failed", (job, err) => {
    logger.error(`❌ Analytics job ${job.id} failed with error: ${err.message}`, {
      jobId: job.id,
      seekerId: job.data.seekerId,
      attempts: job.attemptsMade,
      error: err.stack
    });
  })
  .on("error", (err) => {
    logger.error(`❌ Analytics worker error: ${err.message}`, {
      error: err.stack
    });
  })
  .on("stalled", (jobId) => {
    logger.warn(`⚠️ Analytics job ${jobId} has stalled`);
  })
  .on("progress", (job, progress) => {
    logger.debug(`📊 Analytics job ${job.id} progress: ${progress}%`);
  });

// Graceful shutdown handling
process.on("SIGTERM", async () => {
  await analyticsWorker.close();
});

export default analyticsWorker;
