// redis.js

import { createClient } from 'redis';
import { logger } from '../utils/logger.js';

const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    tls: process.env.REDIS_TLS === 'true', // Enable TLS if required
  },
  password: process.env.REDIS_PASSWORD,
});

redisClient.on('error', (err) => {
  logger.error('❌ Redis Client Error', err);
});

redisClient
  .connect()
  .then(() => logger.info('✅ Connected to Redis'))
  .catch((err) => {
    logger.error('❌ Redis connection error:', err);
    process.exit(1);
  });

export { redisClient };
