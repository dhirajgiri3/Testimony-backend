import { redis } from "../config/redis.js";
import AppError from "../utils/appError.js";
import { logger } from "../utils/logger.js";

/**
 * Enhanced cache middleware with bypass option
 */
export const cache = (duration) => async (req, res, next) => {
  if (req.method !== "GET" || req.headers["x-bypass-cache"]) return next();

  const key = `cache:${req.originalUrl}`;

  try {
    const cachedData = await redis.get(key);
    if (cachedData) {
      logger.info(`✅ Cache hit for key: ${key}`);
      return res.status(200).json(JSON.parse(cachedData));
    }

    res.originalJson = res.json;
    res.json = async (body) => {
      if (body) {
        await redis.setex(key, duration, JSON.stringify(body));
        logger.info(`✅ Cache set for key: ${key}`);
      }
      return res.originalJson(body);
    };

    next();
  } catch (error) {
    logger.error("❌ Cache middleware error:", error);
    next(new AppError("Cache service unavailable", 503));
  }
};

export const createCacheManager = (prefix = "", defaultTTL = 3600) => {
  const buildKey = (key) => (prefix ? `${prefix}:${key}` : key);

  return {
    async get(key, defaultValue = null) {
      try {
        const data = await redis.get(buildKey(key));
        return data ? JSON.parse(data) : defaultValue;
      } catch (error) {
        logger.error(`Cache get error for ${key}:`, error);
        return defaultValue;
      }
    },

    async set(key, value, ttl = defaultTTL) {
      try {
        await redis.setex(buildKey(key), ttl, JSON.stringify(value));
        return true;
      } catch (error) {
        logger.error(`Cache set error for ${key}:`, error);
        return false;
      }
    },

    async exists(key) {
      try {
        return await redis.exists(buildKey(key));
      } catch (error) {
        logger.error(`Cache exists error for ${key}:`, error);
        return false;
      }
    },

    async delete(key) {
      try {
        await redis.del(buildKey(key));
        return true;
      } catch (error) {
        logger.error(`Cache delete error for ${key}:`, error);
        return false;
      }
    },

    async getOrSet(key, callback, ttl = defaultTTL) {
      const cacheKey = buildKey(key);
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);

        const value = await callback();
        if (value !== null && value !== undefined) {
          await redis.setex(cacheKey, ttl, JSON.stringify(value));
        }
        return value;
      } catch (error) {
        logger.error(`Cache getOrSet error for ${key}:`, error);
        return await callback(); // Fallback to callback on cache error
      }
    },

    async clearPattern(pattern) {
      try {
        const keys = await redis.keys(buildKey(pattern));
        if (keys.length > 0) {
          await redis.del(...keys);
          logger.info(
            `Cleared ${keys.length} keys matching pattern: ${pattern}`
          );
        }
        return true;
      } catch (error) {
        logger.error(`Cache clear pattern error for ${pattern}:`, error);
        return false;
      }
    },

    async increment(key, value = 1) {
      try {
        return await redis.incrby(buildKey(key), value);
      } catch (error) {
        logger.error(`Cache increment error for ${key}:`, error);
        return null;
      }
    },

    generateKey: (...args) => args.filter((arg) => arg !== undefined).join(":"),
  };
};

export const cacheManager = createCacheManager("testimony");

// Export simplified helper functions
export const {
  get: getCache,
  set: setCache,
  delete: delCache,
  generateKey: generateCacheKey,
} = cacheManager;

/**
 * Invalidate cache for specific keys
 */
export const invalidateCache = async (keys) => {
  try {
    if (!Array.isArray(keys)) {
      keys = [keys];
    }
    await Promise.all(keys.map((key) => redis.del(key)));
    logger.info(`✅ Cache invalidated for keys: ${keys.join(", ")}`);
  } catch (error) {
    logger.error("❌ Cache invalidation error:", error);
  }
};
