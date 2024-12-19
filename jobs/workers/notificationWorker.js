import { Worker } from "bullmq";
import { sendInAppNotification } from "../../services/notificationService.js";
import { logger } from "../../utils/logger.js";
import {redis} from "../../config/redis.js";

const notificationWorker = new Worker(
  "notificationQueue",
  async (job) => {
    const { userId, message } = job.data;
    if (!userId || !message) {
      throw new Error(
        `Invalid job data. Missing 'userId' or 'message' for job ${job.id}`
      );
    }

    try {
      await sendInAppNotification(userId, message);
      logger.info(`🔔 In-app notification sent to user: ${userId}`);
    } catch (error) {
      logger.error(
        `❌ Error processing notification job ${job.id}: ${error.message}`
      );
      throw error; // Ensure BullMQ handles retries
    }
  },
  { connection: redis, concurrency: 10 }
);

// Event Listeners
notificationWorker.on("completed", (job) => {
  logger.info(`✅ Notification job ${job.id} completed successfully.`);
});

notificationWorker.on("failed", (job, err) => {
  logger.error(
    `❌ Notification job ${job.id} failed with error: ${err.message}`
  );
});

export default notificationWorker;
