// src/jobs/queues.js

import { Queue, QueueScheduler, Worker, QueueEvents } from 'bullmq';
import { redisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';

// Initialize Queue Schedulers for reliable job processing
const emailQueueScheduler = new QueueScheduler('emailQueue', {
  connection: redisClient,
});
emailQueueScheduler.on('error', (err) => {
  logger.error('❌ Email Queue Scheduler Error:', err);
});

const notificationQueueScheduler = new QueueScheduler('notificationQueue', {
  connection: redisClient,
});
notificationQueueScheduler.on('error', (err) => {
  logger.error('❌ Notification Queue Scheduler Error:', err);
});

// Define the Email Queue
const emailQueue = new Queue('emailQueue', {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});
const emailQueueEvents = new QueueEvents('emailQueue', {
  connection: redisClient,
});

// Define the Notification Queue
const notificationQueue = new Queue('notificationQueue', {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});
const notificationQueueEvents = new QueueEvents('notificationQueue', {
  connection: redisClient,
});

// Export the queues and their events
export const queues = {
  emailQueue,
  emailQueueEvents,
  notificationQueue,
  notificationQueueEvents,
};

// Event Listeners for Email Queue
emailQueueEvents.on('completed', ({ jobId }) => {
  logger.info(`✅ Email job ${jobId} completed successfully.`);
});

emailQueueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`❌ Email job ${jobId} failed. Reason: ${failedReason}`);
});

emailQueueEvents.on('stalled', ({ jobId }) => {
  logger.warn(`⚠️ Email job ${jobId} has stalled.`);
});

// Event Listeners for Notification Queue
notificationQueueEvents.on('completed', ({ jobId }) => {
  logger.info(`✅ Notification job ${jobId} completed successfully.`);
});

notificationQueueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`❌ Notification job ${jobId} failed. Reason: ${failedReason}`);
});

notificationQueueEvents.on('stalled', ({ jobId }) => {
  logger.warn(`⚠️ Notification job ${jobId} has stalled.`);
});

// Graceful shutdown function
export const shutdownQueues = async () => {
  try {
    logger.info('🔄 Shutting down queues...');
    await emailQueueScheduler.close();
    await notificationQueueScheduler.close();
    await emailQueue.close();
    await notificationQueue.close();
    await emailQueueEvents.close();
    await notificationQueueEvents.close();
    logger.info('✅ Queues shut down successfully.');
  } catch (error) {
    logger.error('❌ Error shutting down queues:', error);
  }
};

// Handle process termination signals
process.on('SIGTERM', shutdownQueues);
process.on('SIGINT', shutdownQueues);
