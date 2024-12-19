// src/config/redis.js
import Redis from "ioredis";
import dotenv from "dotenv";
import { logger } from "../utils/logger.js";

dotenv.config();

const redisOptions = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT, 10),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_TLS === "true" ? { rejectUnauthorized: false } : undefined,
  maxRetriesPerRequest: null, // Required for BullMQ
  connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT, 10) || 5000, // Reduced timeout
  keepAlive: parseInt(process.env.REDIS_KEEP_ALIVE, 10) || 60000,
  retryStrategy: (times) => {
    if (times >= 30) return new Error('Redis connection failed after 30 attempts');
    return Math.min(times * 100, 3000); // Exponential backoff: 100ms, 200ms, ..., up to 3000ms
  },
};

// **Single Redis connection to be reused everywhere in the app**
const redis = new Redis(redisOptions);

redis.on("connect", () => {
  logger.info("✅ Connected to Redis");
});

redis.on("error", (error) => {
  logger.error("❌ Redis Connection Error:", error);
});

export default redis;