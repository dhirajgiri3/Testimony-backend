// src/middlewares/cache.js

import { redisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

/**
 * Cache middleware using Redis with bypass option.
 *
 * @param {number} duration - Cache duration in seconds.
 * @returns {Function} - Express middleware function.
 */
export const cache = (duration) => async (req, res, next) => {
  if (req.method !== 'GET' || req.headers['x-bypass-cache']) {
    return next();
  }

  const key = `cache:${req.originalUrl}`;

  try {
    const cachedData = await redisClient.get(key);
    if (cachedData) {
      logger.info(`✅ Cache hit for key: ${key}`);
      return res.status(200).json(JSON.parse(cachedData));
    }

    res.originalJson = res.json;
    res.json = async (body) => {
      if (body) {
        await redisClient.setEx(key, duration, JSON.stringify(body));
        logger.info(`✅ Cache set for key: ${key}`);
      }
      return res.originalJson(body);
    };

    next();
  } catch (error) {
    logger.error(`❌ Cache middleware error for key ${key}:`, error);
    next(new AppError('Cache service unavailable', 503));
  }
};

/**
 * Creates a dedicated cache manager with a specific prefix.
 *
 * @param {string} prefix - Prefix for cache keys.
 * @param {number} defaultTTL - Default Time-To-Live for cache entries.
 * @returns {Object} - Cache manager with utility functions.
 */
export const createCacheManager = (prefix = '', defaultTTL = 3600) => {
  const buildKey = (key) => (prefix ? `${prefix}:${key}` : key);

  return {
    /**
     * Retrieves data from cache or executes callback to set cache.
     *
     * @param {string} key - Cache key.
     * @param {Function} callback - Function to execute if cache miss.
     * @param {number} ttl - Time-To-Live for the cache entry.
     * @returns {Promise<Object>} - Cached or newly set data.
     */
    async getOrSet(key, callback, ttl = defaultTTL) {
      const cacheKey = buildKey(key);
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) return JSON.parse(cached);

        const value = await callback();
        if (value !== null && value !== undefined) {
          await redisClient.setEx(cacheKey, ttl, JSON.stringify(value));
          logger.info(`✅ Cache set for key: ${cacheKey}`);
        }
        return value;
      } catch (error) {
        logger.error(`❌ Cache getOrSet error for key ${cacheKey}:`, error);
        return await callback(); // Fallback to callback on cache error
      }
    },

    /**
     * Deletes a cache entry by key.
     *
     * @param {string} key - Cache key to delete.
     * @returns {Promise<boolean>} - True if deletion was successful.
     */
    async delete(key) {
      const cacheKey = buildKey(key);
      try {
        await redisClient.del(cacheKey);
        logger.info(`✅ Cache deleted for key: ${cacheKey}`);
        return true;
      } catch (error) {
        logger.error(`❌ Cache delete error for key ${cacheKey}:`, error);
        return false;
      }
    },

    /**
     * Generates a cache key by joining multiple parts.
     *
     * @param  {...string} parts - Parts of the cache key.
     * @returns {string} - Generated cache key.
     */
    generateKey: (...parts) =>
      parts.filter((part) => part !== undefined).join(':'),
  };
};

export const cacheManager = createCacheManager('testimony');

// Export simplified helper functions
export const {
  getOrSet,
  delete: delCache,
  generateKey: generateCacheKey,
} = cacheManager;
