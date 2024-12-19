import { Worker } from "bullmq";
import { generateAITestimonial } from "../../services/aiService.js";
import { logger } from "../../utils/logger.js";
import redis from "../../config/redis.js";
import queues from "../queues.js";

// Worker configuration constants
const WORKER_CONFIG = {
  connection: redis,
  concurrency: 5,
  maxStalledCount: 3,
  stalledInterval: 30000, // 30 seconds
  lockDuration: 60000, // 1 minute
  removeOnComplete: {
    count: 1000,
    age: 24 * 3600, // 24 hours
  },
  removeOnFail: {
    count: 500,
    age: 7 * 24 * 3600, // 7 days
  },
};

const aiWorker = new Worker(
  "aiQueue",
  async (job) => {
    const { projectDetails, userId, priority = "normal" } = job.data;

    if (!projectDetails || !userId) {
      throw new Error(
        `Invalid job data. Missing 'projectDetails' or 'userId' for job ${job.id}`
      );
    }

    try {
      // Update job progress
      await job.updateProgress(10);

      // Generate AI testimonial
      const aiTestimonial = await generateAITestimonial(projectDetails);
      await job.updateProgress(50);

      logger.info(`🔍 AI Testimonial generated for user: ${userId}`, {
        jobId: job.id,
        userId,
      });

      // Enqueue notification job
      await queues.notificationQueue.add(
        "sendInAppNotification",
        {
          userId,
          message: "Your AI-generated testimonial is ready.",
          testimonial: aiTestimonial,
        },
        { priority: priority === "high" ? 1 : 2 }
      );

      // Trigger analytics update if high priority
      if (priority === "high") {
        await queues.analyticsQueue.add(
          "updateAnalytics",
          { seekerId: userId },
          { priority: 2 }
        );
      }

      await job.updateProgress(100);

      return { success: true, userId, testimonial: aiTestimonial };
    } catch (error) {
      logger.error(`❌ Error processing AI job ${job.id}: ${error.message}`, {
        jobId: job.id,
        userId,
        error: error.stack,
      });

      // Notify admin for critical errors
      if (job.attemptsMade >= 2) {
        await queues.notificationQueue.add(
          "sendAdminAlert",
          {
            type: "AI_GENERATION_FAILURE",
            jobId: job.id,
            userId,
            error: error.message,
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
aiWorker
  .on("completed", (job, result) => {
    logger.info(`✅ AI job ${job.id} completed successfully.`, {
      jobId: job.id,
      userId: job.data.userId,
      result,
    });
  })
  .on("failed", (job, err) => {
    logger.error(`❌ AI job ${job.id} failed with error: ${err.message}`, {
      jobId: job.id,
      userId: job.data.userId,
      attempts: job.attemptsMade,
      error: err.stack,
    });
  })
  .on("error", (err) => {
    logger.error(`Worker error: ${err.message}`, { error: err.stack });
  });

export default aiWorker;
