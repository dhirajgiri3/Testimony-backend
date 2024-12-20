// src/services/tokenService.js

import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { redisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
import User from '../models/User.js';
import tokenBlacklistService from './tokenBlacklistService.js';

/**
 * Sign a JWT token with a unique identifier.
 *
 * @param {Object} payload - Payload to include in the token.
 * @param {string} secret - Secret key for signing.
 * @param {Object} options - Additional JWT options.
 * @returns {string} - Signed JWT token.
 */
const signJwt = (payload, secret, options) => {
  return jwt.sign(payload, secret, { ...options, jwtid: uuidv4() });
};

/**
 * Verify a JWT token.
 *
 * @param {string} token - JWT token to verify.
 * @param {string} secret - Secret key for verification.
 * @returns {Object} - Decoded token payload.
 * @throws {Error} - If verification fails.
 */
const verifyJwt = (token, secret) => {
  return jwt.verify(token, secret);
};

/**
 * Generate an access token for a user.
 *
 * @param {Object} user - User object.
 * @returns {string} - JWT access token.
 */
export const generateAccessToken = (user) => {
  const payload = {
    id: user._id,
    role: user.role,
  };
  return signJwt(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
};

/**
 * Generate a refresh token for a user.
 *
 * @param {Object} user - User object.
 * @returns {string} - JWT refresh token.
 */
export const generateRefreshToken = (user) => {
  const payload = {
    id: user._id,
    tokenVersion: user.tokenVersion,
  };
  return signJwt(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
};

/**
 * Verify and decode a token, checking if it's blacklisted.
 *
 * @param {string} token - JWT token to verify.
 * @param {string} secret - Secret key for verification.
 * @param {string} type - Type of token ('access' or 'refresh').
 * @returns {Object} - Decoded token payload.
 * @throws {AppError} - If verification fails or token is blacklisted.
 */
export const verifyAndCheckToken = async (token, secret, type) => {
  try {
    const decoded = verifyJwt(token, secret);
    const jti = decoded.jti;

    if (!jti) {
      throw new AppError('Token missing jti.', 401);
    }

    const isBlacklisted = await tokenBlacklistService.isTokenBlacklisted(jti);
    if (isBlacklisted) {
      throw new AppError('Token has been revoked.', 401);
    }

    return decoded;
  } catch (error) {
    logger.error(`Token verification failed for ${type} token:`, error.message);
    throw new AppError(`Invalid ${type} token.`, 401);
  }
};

/**
 * Rotate refresh token, optionally blacklisting the old one.
 *
 * @param {Object} user - User object.
 * @param {string|null} oldRefreshToken - The old refresh token to blacklist.
 * @param {boolean} blacklistOldToken - Whether to blacklist the old token.
 * @returns {Promise<string>} - New refresh token.
 * @throws {AppError} - If rotation fails.
 */
export const rotateRefreshToken = async (
  user,
  oldRefreshToken = null,
  blacklistOldToken = false
) => {
  if (blacklistOldToken && oldRefreshToken) {
    try {
      const decodedOld = jwt.verify(oldRefreshToken, process.env.JWT_REFRESH_SECRET);
      if (decodedOld && decodedOld.jti) {
        await tokenBlacklistService.blacklistToken(
          decodedOld.jti,
          7 * 24 * 60 * 60
        ); // 7 days
      } else {
        throw new Error('Invalid token structure.');
      }
    } catch (error) {
      logger.error('Failed to blacklist old refresh token:', error.message);
      throw new AppError('Failed to rotate refresh token.', 500);
    }
  }

  // Increment token version to invalidate existing refresh tokens
  user.tokenVersion += 1;
  await user.save();

  // Generate new refresh token
  return generateRefreshToken(user);
};

/**
 * Refresh tokens using a valid refresh token.
 *
 * @param {string} refreshToken - JWT refresh token.
 * @returns {Promise<Object>} - New access and refresh tokens.
 * @throws {AppError} - If refresh fails.
 */
export const refreshTokens = async (refreshToken) => {
  try {
    const decoded = await verifyAndCheckToken(
      refreshToken,
      process.env.JWT_REFRESH_SECRET,
      'refresh'
    );

    const user = await User.findById(decoded.id);
    if (!user) {
      throw new AppError('User not found.', 401);
    }

    if (decoded.tokenVersion !== user.tokenVersion) {
      throw new AppError('Refresh token has been revoked.', 401);
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = await rotateRefreshToken(user, refreshToken, true);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  } catch (error) {
    logger.error('Failed to refresh tokens:', error.message);
    throw new AppError('Failed to refresh tokens.', 401);
  }
};

/**
 * Revoke all tokens for a user by incrementing the token version.
 *
 * @param {string} userId - ID of the user.
 * @returns {Promise<void>}
 * @throws {AppError} - If revocation fails.
 */
export const revokeAllTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found.', 404);
    }

    user.tokenVersion += 1;
    await user.save();

    logger.info(`✅ All tokens revoked for user ${userId}`);
  } catch (error) {
    logger.error(`❌ Error revoking tokens for user ${userId}:`, error);
    throw new AppError('Failed to revoke tokens.', 500);
  }
};

export default {
  generateAccessToken,
  generateRefreshToken,
  verifyAndCheckToken,
  rotateRefreshToken,
  refreshTokens,
  revokeAllTokens,
};
