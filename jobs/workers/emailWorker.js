import { Worker } from "bullmq";
import {
  sendVerificationEmail,
  sendTestimonialRequestEmail,
  sendPasswordResetEmail,
} from "../../services/emailService.js";
import { logger } from "../../utils/logger.js";
import { redis } from "../../config/redis.js";

const emailWorker = new Worker(
  "emailQueue",
  async (job) => {
    const {
      email,
      subject,
      html,
      giverEmail,
      link,
      seekerName,
      resetEmail,
      resetUrl,
      projectDetails,
    } = job.data;

    try {
      switch (job.name) {
        case "sendVerificationEmail":
          await sendVerificationEmail(email, subject, html);
          logger.info(`📧 Verification email sent to ${email}`);
          break;
        case "sendTestimonialRequestEmail":
          await sendTestimonialRequestEmail(giverEmail, link, seekerName, projectDetails);
          logger.info(`📧 Testimonial request email sent to ${giverEmail}`);
          break;
        case "sendPasswordResetEmail":
          await sendPasswordResetEmail(resetEmail, resetUrl);
          logger.info(`📧 Password reset email sent to ${resetEmail}`);
          break;
        default:
          throw new Error(`Unknown email job type: ${job.name}`);
      }
    } catch (error) {
      logger.error(`❌ Error processing email job ${job.id}: ${error.message}`);
      throw error; // Ensure BullMQ handles retries
    }
  },
  { connection: redis, concurrency: 10 }
);

// Event Listeners
emailWorker.on("completed", (job) => {
  logger.info(`✅ Email job ${job.id} completed successfully.`);
});

emailWorker.on("failed", (job, err) => {
  logger.error(`❌ Email job ${job.id} failed with error: ${err.message}`);
});

export default emailWorker;
