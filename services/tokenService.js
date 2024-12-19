// src/services/tokenService.js

import jwt from "jsonwebtoken";
import { addToTokenBlacklist } from "./tokenBlacklistService.js";
import User from "../models/User.js";
import AppError from "../utils/appError.js";
import { logger } from "../utils/logger.js";

/**
 * Create JWT Access Token
 * @param {Object} user
 * @returns {string} JWT access token
 */
export const createAccessToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role, tokenVersion: user.tokenVersion },
    process.env.JWT_ACCESS_SECRET,
    {
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    }
  );
};

/**
 * Create JWT Refresh Token
 * @param {Object} user
 * @returns {string} JWT refresh token
 */
export const createRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role, tokenVersion: user.tokenVersion },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
    }
  );
};

/**
 * Verify JWT Token
 * @param {string} token
 * @param {string} secret
 * @returns {Object} Decoded token
 * @throws {Error} If token invalid
 */
export const verifyToken = (token, secret) => {
  try {
    return jwt.verify(token, secret);
  } catch (error) {
    logger.error("Token verification failed:", error);
    throw new AppError("Invalid token", 401);
  }
};

/**
 * Rotate Refresh Token
 * @param {string} oldRefreshToken
 * @param {Object} res - Express response object
 * @returns {Object} new tokens
 */
export const rotateRefreshToken = async (oldRefreshToken, res) => {
  try {
    const decoded = verifyToken(oldRefreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      throw new AppError("User not found", 401);
    }

    // Check token version
    if (decoded.tokenVersion !== user.tokenVersion) {
      throw new AppError("Refresh token is invalid due to security update", 401);
    }

    // Blacklist the old refresh token
    await addToTokenBlacklist(oldRefreshToken, "refresh");

    // Create new tokens
    const accessToken = createAccessToken(user);
    const refreshToken = createRefreshToken(user);

    // Set tokens in HttpOnly cookies
    res.cookie("access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie("refresh_token", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return { accessToken, refreshToken };
  } catch (error) {
    logger.error("Error rotating refresh token:", error);
    throw new AppError("Invalid refresh token", 401);
  }
};

/**
 * Invalidate Tokens
 * @param {string} accessToken
 * @param {string} refreshToken
 */
export const invalidateTokens = async (accessToken, refreshToken) => {
  try {
    if (accessToken) {
      await addToTokenBlacklist(accessToken, "access");
    }
    if (refreshToken) {
      await addToTokenBlacklist(refreshToken, "refresh");
    }
  } catch (error) {
    logger.error("Error invalidating tokens:", error);
    throw new AppError("Error invalidating tokens", 500);
  }
};
