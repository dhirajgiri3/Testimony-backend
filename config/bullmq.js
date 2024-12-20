// bullmq.js

import { Queue, Worker, QueueScheduler } from 'bullmq';
import { redisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';

// Initialize Queue Scheduler for reliable job processing
const testimonialQueueScheduler = new QueueScheduler('testimonialQueue', {
  connection: redisClient,
});
testimonialQueueScheduler.on('error', (err) => {
  logger.error('❌ Testimonial Queue Scheduler error:', err);
});

// Define the Testimonial Queue
const testimonialQueue = new Queue('testimonialQueue', { connection: redisClient });

// Example: Adding a job to the queue
const addTestimonialJob = async (data) => {
  try {
    await testimonialQueue.add('processTestimonial', data, {
      attempts: 3,
      backoff: 5000, // Retry after 5 seconds
    });
    logger.info('✅ Testimonial job added to the queue');
  } catch (error) {
    logger.error('❌ Failed to add testimonial job to the queue:', error);
  }
};

// Define a worker to process jobs in the queue
const testimonialWorker = new Worker(
  'testimonialQueue',
  async (job) => {
    try {
      logger.info(`👷 Processing job ${job.id} of type ${job.name}`);
      // Add your job processing logic here
      // For example: await processTestimonial(job.data);
      logger.info(`✅ Job ${job.id} completed successfully`);
    } catch (error) {
      logger.error(`❌ Job ${job.id} failed:`, error);
      throw error; // Ensure the job is marked as failed
    }
  },
  { connection: redisClient }
);

testimonialWorker.on('completed', (job) => {
  logger.info(`🎉 Job ${job.id} has been completed`);
});

testimonialWorker.on('failed', (job, err) => {
  logger.error(`💥 Job ${job.id} has failed with error ${err.message}`);
});

testimonialWorker.on('error', (err) => {
  logger.error('❌ Testimonial Worker error:', err);
});

export { testimonialQueue, addTestimonialJob, testimonialWorker };
