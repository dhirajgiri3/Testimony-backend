// src/services/tokenService.js

import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { redis } from "../config/redis.js";
import { logger } from "../utils/logger.js";
import AppError from "../utils/appError.js";
import User from "../models/User.js"; // Ensure User model is imported

const signJwt = (payload, secret, options) => {
  return jwt.sign(payload, secret, { ...options, jwtid: uuidv4() });
};

const verifyJwt = (token, secret) => {
  return jwt.verify(token, secret);
};

/**
 * Generate Access Token
 * @param {Object} user - User object
 * @returns {string} JWT Access Token
 */
export const generateAccessToken = (user) => {
  const payload = {
    id: user._id,
    role: user.role,
  };
  return signJwt(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
};

/**
 * Generate Refresh Token
 * @param {Object} user - User object
 * @returns {string} JWT Refresh Token
 */
export const generateRefreshToken = (user) => {
  const payload = {
    id: user._id,
    tokenVersion: user.tokenVersion,
  };
  return signJwt(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: "7d" });
};

/**
 * Verify and Decode Token
 * @param {string} token - JWT token
 * @param {string} secret - Secret key
 * @param {string} type - 'access' or 'refresh'
 * @returns {Object} Decoded token
 */
export const verifyAndCheckToken = async (token, secret, type) => {
  try {
    const decoded = verifyJwt(token, secret);
    const jti = decoded.jti;

    if (await isTokenBlacklisted(jti)) {
      throw new AppError(`Token has been revoked`, 401);
    }

    return decoded;
  } catch (error) {
    logger.error(
      `Token verification failed for ${type} token: ${error.message}`
    );
    throw new AppError(`Invalid ${type} token`, 401);
  }
};

/**
 * Rotate Refresh Token
 * @param {Object} user - User object
 * @param {string} oldRefreshToken - Old Refresh Token
 * @param {boolean} blacklistOldToken - Whether to blacklist the old refresh token
 * @returns {string} New Refresh Token
 */
export const rotateRefreshToken = async (
  user,
  oldRefreshToken = null,
  blacklistOldToken = false
) => {
  if (blacklistOldToken && oldRefreshToken) {
    const decodedOld = verifyJwt(
      oldRefreshToken,
      process.env.JWT_REFRESH_SECRET
    );
    await blacklistToken(decodedOld.jti, 7 * 24 * 60 * 60); // 7 days in seconds
  }

  // Increment token version to invalidate existing refresh tokens
  user.tokenVersion += 1;
  await user.save();

  // Generate new refresh token
  return generateRefreshToken(user);
};

/**
 * Blacklist a token by storing its jti in Redis
 * @param {string} jti - JWT ID of the token to blacklist
 * @param {number} expiresIn - Token expiration time in seconds
 */
export const blacklistToken = async (jti, expiresIn) => {
  try {
    await redis.set(`blacklist:${jti}`, "true", "EX", expiresIn);
    logger.info(`✅ Token blacklisted: ${jti}`);
  } catch (error) {
    logger.error(`❌ Error blacklisting token: ${error.message}`);
    throw new AppError("Failed to blacklist token", 500);
  }
};

/**
 * Check if a token is blacklisted
 * @param {string} jti - JWT ID of the token to check
 * @returns {boolean} Whether the token is blacklisted
 */
export const isTokenBlacklisted = async (jti) => {
  try {
    const result = await redis.get(`blacklist:${jti}`);
    return result === "true";
  } catch (error) {
    logger.error(`❌ Error checking token blacklist: ${error.message}`);
    // To prevent unauthorized access due to Redis failure, default to not blacklisted
    return false;
  }
};

/**
 * Refresh Access Token using Refresh Token
 * @param {string} refreshToken - JWT Refresh Token
 * @returns {Object} New Access Token and Refresh Token
 */
export const refreshTokens = async (refreshToken) => {
  try {
    const decoded = await verifyAndCheckToken(
      refreshToken,
      process.env.JWT_REFRESH_SECRET,
      "refresh"
    );
    const user = await User.findById(decoded.id);

    if (!user) {
      throw new AppError("User not found", 401);
    }

    if (decoded.tokenVersion !== user.tokenVersion) {
      throw new AppError("Token has been revoked", 401);
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = await rotateRefreshToken(user, refreshToken, true);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  } catch (error) {
    logger.error(`❌ Refresh token failed: ${error.message}`);
    throw new AppError("Invalid refresh token", 401);
  }
};

/**
 * Verify a refresh token and return decoded payload
 * @param {string} refreshToken - JWT refresh token to verify
 * @returns {Promise<Object>} Decoded token payload
 * @throws {AppError} If token is invalid, expired or blacklisted
 */
export const verifyRefreshToken = async (refreshToken) => {
  if (!refreshToken) {
    throw new AppError('Refresh token is required', 400);
  }

  try {
    // Verify and check if token is blacklisted
    const decoded = await verifyAndCheckToken(
      refreshToken,
      process.env.JWT_REFRESH_SECRET,
      'refresh'
    );

    // Find user and validate token version
    const user = await User.findById(decoded.id);
    if (!user || decoded.tokenVersion !== user.tokenVersion) {
      throw new AppError('Invalid refresh token', 401);
    }

    return decoded;
  } catch (error) {
    logger.error(`Refresh token verification failed: ${error.message}`);
    throw new AppError(error.message || 'Invalid refresh token', 401);
  }
};