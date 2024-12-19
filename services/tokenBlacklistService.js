// src/services/tokenBlacklistService.js

import BlacklistedToken from "../models/BlacklistedToken.js";
import { redis } from "../config/redis.js";
import { logger } from "../utils/logger.js";
import AppError from "../utils/appError.js";

const BLACKLIST_PREFIX = "token_blacklist:";
const DEFAULT_ACCESS_EXPIRY = "15m";
const DEFAULT_REFRESH_EXPIRY = "7d";

/**
 * Add a token to the blacklist
 * @param {string} token - The token to blacklist
 * @param {string} type - Type of the token ('access' or 'refresh')
 * @throws {AppError} If token is invalid or operation fails
 */
export const addToTokenBlacklist = async (token, type = "access") => {
  if (!token) {
    throw new AppError("Token is required", 400);
  }

  const expireAt = type === "access" 
    ? process.env.JWT_ACCESS_EXPIRES_IN || DEFAULT_ACCESS_EXPIRY
    : type === "refresh"
      ? process.env.JWT_REFRESH_EXPIRES_IN || DEFAULT_REFRESH_EXPIRY
      : null;

  if (!expireAt) {
    throw new AppError("Invalid token type", 400);
  }

  const expirySeconds = jwtDecodeDuration(expireAt);
  if (!expirySeconds) {
    throw new AppError("Invalid token expiration format", 400);
  }

  try {
    const expireDate = new Date(Date.now() + expirySeconds * 1000);
    
    // Use Promise.all for parallel execution
    await Promise.all([
      BlacklistedToken.create({ token, expireAt: expireDate, type }),
      redis.setex(`${BLACKLIST_PREFIX}${token}`, expirySeconds, "1")
    ]);

    logger.info(`Token blacklisted successfully`, {
      type,
      expiryDate: expireDate.toISOString()
    });
  } catch (error) {
    logger.error("Failed to blacklist token:", { error, type });
    throw new AppError("Failed to blacklist token", 500);
  }
};

/**
 * Check if a token is blacklisted
 * @param {string} token - The token to check
 * @returns {Promise<boolean>} - True if token is blacklisted
 */
export const isTokenBlacklisted = async (token) => {
  if (!token) return false;

  try {
    // Check Redis first
    const cached = await redis.get(`${BLACKLIST_PREFIX}${token}`);
    if (cached) return true;

    // Fallback to MongoDB
    const blacklisted = await BlacklistedToken.findOne({ token });
    if (blacklisted) {
      const ttl = Math.floor((blacklisted.expireAt - Date.now()) / 1000);
      if (ttl > 0) {
        await redis.setex(`${BLACKLIST_PREFIX}${token}`, ttl, "1");
      }
      return true;
    }

    return false;
  } catch (error) {
    logger.error("Error checking token blacklist:", { error });
    return true; // Fail secure - assume token is blacklisted on error
  }
};

/**
 * Helper function to decode JWT duration strings
 * @param {string} durationStr - Duration string (e.g., '15m', '7d')
 * @returns {number|null} Duration in seconds
 */
const jwtDecodeDuration = (durationStr) => {
  const unitMultipliers = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400
  };

  const match = durationStr.match(/^(\d+)([smhd])$/);
  if (!match) return null;

  const [, value, unit] = match;
  const multiplier = unitMultipliers[unit];
  
  return multiplier ? parseInt(value, 10) * multiplier : null;
};

// Optional: Add cleanup method for expired tokens
export const cleanupExpiredTokens = async () => {
  try {
    const result = await BlacklistedToken.deleteMany({
      expireAt: { $lt: new Date() }
    });
    logger.info(`Cleaned up ${result.deletedCount} expired tokens`);
  } catch (error) {
    logger.error("Failed to cleanup expired tokens:", error);
  }
};
