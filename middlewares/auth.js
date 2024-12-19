// src/middlewares/auth.js

import asyncHandler from "express-async-handler";
import User from "../models/User.js";
import { isTokenBlacklisted } from "../services/tokenBlacklistService.js";
import { createError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { verifyAndCheckToken } from "../services/tokenService.js";
import { twoFactorService } from "../services/twoFactorService.js";

/**
 * Base authentication check
 * Verifies JWT, checks blacklist, and attaches user to request
 */
const baseAuthCheck = async (token) => {
  if (!token) {
    throw createError("authentication", "Not authorized, token missing", 401);
  }

  try {
    // Check if token is blacklisted
    const isBlacklistedToken = await isTokenBlacklisted(token);
    if (isBlacklistedToken) {
      throw createError("authentication", "Token has been revoked", 401);
    }

    // Verify token
    const decoded = await verifyAndCheckToken(
      token,
      process.env.JWT_ACCESS_SECRET,
      "access"
    );

    // Fetch user and select necessary fields
    const user = await User.findById(decoded.id)
      .select("+twoFactorEnabled +twoFactorSecret")
      .lean()
      .exec();

    if (!user) {
      throw createError("authentication", "User not found", 401);
    }

    // Check if password was changed after token issuance
    if (user.passwordChangedAt && user.passwordChangedAfter(decoded.iat)) {
      throw createError(
        "authentication",
        "Password recently changed, please log in again",
        401
      );
    }

    return { user, decoded };
  } catch (error) {
    logger.error("Authentication error:", error);
    throw createError("authentication", "Authentication failed", 401);
  }
};

/**
 * Protect middleware to secure routes with two-factor authentication
 */
export const protect = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.access_token;
  const { user, decoded } = await baseAuthCheck(token);
  req.user = user;
  logger.debug(`Authenticated user: ${user._id}`);

  // If 2FA is enabled, verify it
  if (user.isTwoFactorEnabled) {
    // Check if 2FA has been verified in the current session
    if (!req.session.isTwoFactorAuthenticated) {
      return res.status(401).json({
        success: false,
        message: "Two-factor authentication required",
      });
    }
  }

  next();
});

/**
 * Authorize middleware for role-based access control
 * @param  {...string} roles - Allowed user roles
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(createError("authorization", "User not authenticated", 401));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        createError(
          "authorization",
          `Required role: ${roles.join(" or ")}`,
          403
        )
      );
    }
    next();
  };
};
