// src/services/tokenBlacklistService.js

import { redis } from "../config/redis.js";
import { logger } from "../utils/logger.js";
import AppError from "../utils/appError.js";
import Token from "../models/Token.js";

const BLACKLIST_PREFIX = "blacklist:";

/**
 * Retry helper function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} retries - Number of retries
 * @param {number} delay - Initial delay in milliseconds
 */
const retryOperation = async (fn, retries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      logger.error(`❌ Attempt ${attempt} failed: ${error.message}`);
      if (attempt < retries) {
        await new Promise((res) => setTimeout(res, delay));
        delay *= 2; // Exponential backoff
      } else {
        throw error;
      }
    }
  }
};

/**
 * Blacklist a token by storing it in Redis
 * @param {string} token - JWT token to blacklist
 * @param {number} expiresInSeconds - Token expiration time in seconds
 */
export const blacklistToken = async (token, expiresInSeconds) => {
  try {
    await retryOperation(() =>
      redis.set(`${BLACKLIST_PREFIX}${token}`, "true", "EX", expiresInSeconds)
    );
    logger.info(`✅ Token blacklisted: ${token}`);
  } catch (error) {
    logger.error(`❌ Error blacklisting token: ${error.message}`);
    throw new AppError("Failed to blacklist token", 500);
  }
};

/**
 * Check if a token is blacklisted
 * @param {string} token - JWT token to check
 * @returns {boolean} - True if blacklisted, else false
 */
export const isTokenBlacklisted = async (token) => {
  try {
    const result = await retryOperation(() => redis.get(`${BLACKLIST_PREFIX}${token}`));
    return result === "true";
  } catch (error) {
    logger.error(`❌ Error checking token blacklist: ${error.message}`);
    return false;
  }
};
