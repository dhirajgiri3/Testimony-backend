import pkg from 'bullmq';
const { Queue, QueueScheduler } = pkg;
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
import redis from 'redis';

dotenv.config();

const defaultBullMQOptions = {
  connection: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
};

// Initialize Queues
const queues = {
  emailQueue: new Queue('emailQueue', defaultBullMQOptions),
  testimonialQueue: new Queue('testimonialQueue', defaultBullMQOptions),
  aiQueue: new Queue('aiQueue', defaultBullMQOptions),
  analyticsQueue: new Queue('analyticsQueue', defaultBullMQOptions),
  exportQueue: new Queue('exportQueue', defaultBullMQOptions),
  notificationQueue: new Queue('notificationQueue', defaultBullMQOptions),
};

// Initialize Queue Schedulers
Object.keys(queues).forEach((queueName) => {
  const scheduler = new QueueScheduler(queueName, defaultBullMQOptions);
  scheduler.on('error', (err) => {
    logger.error(`QueueScheduler Error in ${queueName}:`, err);
  });
});

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined,
});

redisClient.on('error', (err) => {
  logger.error('Redis connection error:', err);
});

redisClient.on('connect', () => {
  logger.info('Connected to Redis');
});

export default queues;
