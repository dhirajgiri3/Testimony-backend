// src/jobs/workers/testimonialWorker.js

import { Worker } from "bullmq";
import queues from "../queues.js";
import { 
  processTestimonialSubmission, 
  approveTestimonial, 
  rejectTestimonial, 
  shareTestimonial,
  reportTestimonial,
  archiveTestimonial,
  restoreTestimonial 
} from "../../services/testimonialService.js";
import { logger } from "../../utils/logger.js";
import redis from "../../config/redis.js";

const testimonialWorker = new Worker(
  "testimonialQueue",
  async (job) => {
    try {
      switch (job.name) {
        case "processTestimonial":
          await processTestimonialSubmission(job.data);
          logger.info(`📝 Testimonial processed for job: ${job.id}`);
          break;
        case "approveTestimonial":
          await approveTestimonial(job.data.testimonialId, job.data.giverId, job.data.adminId, job.data.comments);
          logger.info(`✅ Testimonial approved for job: ${job.id}`);
          break;
        case "rejectTestimonial":
          await rejectTestimonial(job.data.testimonialId, job.data.giverId, job.data.adminId, job.data.comments);
          logger.info(`❌ Testimonial rejected for job: ${job.id}`);
          break;
        case "shareTestimonial":
          await shareTestimonial(job.data.testimonialId, job.data.platform, job.data.options);
          logger.info(`📤 Testimonial shared for job: ${job.id}`);
          break;
        case "reportTestimonial":
          await reportTestimonial(job.data.testimonialId, job.data.reportData);
          logger.info(`📌 Testimonial reported for job: ${job.id}`);
          break;
        case "archiveTestimonial":
          await archiveTestimonial(job.data.testimonialId, job.data.options);
          logger.info(`🗄️ Testimonial archived for job: ${job.id}`);
          break;
        case "restoreTestimonial":
          await restoreTestimonial(job.data.testimonialId, job.data.userId);
          logger.info(`🔄 Testimonial restored for job: ${job.id}`);
          break;
        default:
          logger.warn(`⚠️ Unknown testimonial job type: ${job.name}`);
      }
    } catch (error) {
      logger.error(`❌ Error processing testimonial job ${job.id}:`, error);
      throw error; // Ensure BullMQ handles retries
    }
  },
  { connection: redis }
);

// Event Listeners
testimonialWorker.on("completed", (job) => {
  logger.info(`✅ Testimonial job ${job.id} completed successfully.`);
});

testimonialWorker.on("failed", (job, err) => {
  logger.error(
    `❌ Testimonial job ${job.id} failed with error: ${err.message}`
  );
});

// Gracefully handle unexpected errors
testimonialWorker.on("error", (error) => {
  logger.error(`❌ Testimonial Worker encountered an error: ${error.message}`);
});

// Additional event listeners can be added as needed

export default testimonialWorker;
