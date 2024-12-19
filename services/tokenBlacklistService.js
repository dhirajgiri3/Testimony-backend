// src/services/tokenBlacklistService.js

import BlacklistedToken from "../models/BlacklistedToken.js";
import redisClient from "../config/redis.js";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger.js";
import AppError from "../utils/appError.js";

const BLACKLIST_PREFIX = "blacklist:";

/**
 * Add a token to the blacklist
 * @param {string} token - The token to blacklist
 * @param {string} type - Type of the token ('access' or 'refresh')
 * @throws {Error} If token is invalid or MongoDB operation fails
 */
export const addToTokenBlacklist = async (token, type = "access") => {
  if (!token) {
    throw new Error("Token is required");
  }

  let expireAt;
  if (type === "access") {
    expireAt = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
  } else if (type === "refresh") {
    expireAt = process.env.JWT_REFRESH_EXPIRES_IN || "7d";
  } else {
    throw new Error("Invalid token type");
  }

  let expirySeconds;
  // Convert expireAt to seconds
  const duration = jwtDecodeDuration(expireAt);
  if (duration === null) {
    throw new Error("Invalid token expiration time");
  }
  expirySeconds = duration;

  try {
    const expireDate = new Date(Date.now() + expirySeconds * 1000);
    await BlacklistedToken.create({ token, expireAt: expireDate, type });

    await redisClient.set(
      `${BLACKLIST_PREFIX}${token}`,
      "true",
      "EX",
      expirySeconds
    );
    logger.info(
      `✅ Token blacklisted successfully with expiry at ${expireDate}`
    );
  } catch (error) {
    logger.error("❌ Error adding token to blacklist:", { error, token });
    throw new Error("Failed to blacklist token");
  }
};

/**
 * Check if a token is blacklisted
 * @param {string} token - The token to check
 * @returns {Promise<boolean>} - True if token is blacklisted, false otherwise
 */
export const isTokenBlacklisted = async (token) => {
  if (!token) {
    return false;
  }

  try {
    const cached = await redisClient.get(`${BLACKLIST_PREFIX}${token}`);
    if (cached) return true;

    const blacklisted = await BlacklistedToken.findOne({ token });
    if (blacklisted) {
      const ttl = Math.floor((blacklisted.expireAt - Date.now()) / 1000);
      if (ttl > 0) {
        await redisClient.set(`${BLACKLIST_PREFIX}${token}`, "true", "EX", ttl);
      }
      return true;
    }
    return false;
  } catch (error) {
    logger.error("❌ Error checking token blacklist:", { error, token });
    return false;
  }
};

/**
 * Helper function to decode token duration
 * Supports '15m', '7d', etc.
 * @param {string} durationStr
 * @returns {number|null} duration in seconds
 */
const jwtDecodeDuration = (durationStr) => {
  const regex = /^(\d+)([smhd])$/;
  const match = durationStr.match(regex);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 60 * 60;
    case "d":
      return value * 60 * 60 * 24;
    default:
      return null;
  }
};
