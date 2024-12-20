import { Worker } from 'bullmq';
import { exportUserData } from '../../services/userService.js';
import { logger } from '../../utils/logger.js';
import { redis } from '../../config/redis.js';
import { sendDataToUrl } from '../../utils/dataSender.js';

const exportWorker = new Worker(
  'exportQueue',
  async (job) => {
    const { userId, callbackUrl } = job.data;
    if (!userId) {
      throw new Error(`Invalid job data. Missing 'userId' for job ${job.id}`);
    }

    try {
      const data = await exportUserData(userId);
      logger.info(`📂 User data exported for user: ${userId}`);

      if (callbackUrl) {
        await sendDataToUrl(callbackUrl, data);
        logger.info(
          `✉️ Exported user data sent to callback URL: ${callbackUrl}`
        );
      }
    } catch (error) {
      logger.error(
        `❌ Error exporting user data for job ${job.id}: ${error.message}`
      );
      throw error; // Ensure BullMQ handles retries
    }
  },
  { connection: redis, concurrency: 3 }
);

// Event Listeners
exportWorker.on('completed', (job) => {
  logger.info(`✅ Export job ${job.id} completed successfully.`);
});

exportWorker.on('failed', (job, err) => {
  logger.error(`❌ Export job ${job.id} failed with error: ${err.message}`);
});

export default exportWorker;
