// src/services/tokenBlacklistService.js

import { redisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

/**
 * Retry helper function with exponential backoff.
 *
 * @param {Function} fn - Function to retry.
 * @param {number} retries - Number of retries.
 * @param {number} delay - Initial delay in milliseconds.
 * @returns {Promise<any>}
 * @throws {Error} - If all retries fail.
 */
const retryOperation = async (fn, retries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      logger.warn(
        `Retry attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`
      );
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2; // Exponential backoff
    }
  }
};

/**
 * Blacklist a token by storing its JTI in Redis.
 *
 * @param {string} jti - JWT ID of the token to blacklist.
 * @param {number} expiresIn - Token expiration time in seconds.
 * @returns {Promise<void>}
 * @throws {AppError} - If blacklisting fails.
 */
export const blacklistToken = async (jti, expiresIn) => {
  const cacheKey = `blacklist:${jti}`;
  try {
    await retryOperation(() => redisClient.setEx(cacheKey, expiresIn, 'true'));
    logger.info(`✅ Token blacklisted: ${jti}`);
  } catch (error) {
    logger.error(`❌ Error blacklisting token ${jti}:`, error);
    throw new AppError('Failed to blacklist token.', 500);
  }
};

/**
 * Check if a token is blacklisted.
 *
 * @param {string} jti - JWT ID of the token to check.
 * @returns {Promise<boolean>} - True if blacklisted, else false.
 * @throws {AppError} - If checking fails.
 */
export const isTokenBlacklisted = async (jti) => {
  const cacheKey = `blacklist:${jti}`;
  try {
    const result = await retryOperation(() => redisClient.get(cacheKey));
    return result === 'true';
  } catch (error) {
    logger.error(`❌ Error checking token blacklist for ${jti}:`, error);
    throw new AppError('Failed to verify token blacklist status.', 500);
  }
};

export default {
  blacklistToken,
  isTokenBlacklisted,
};
