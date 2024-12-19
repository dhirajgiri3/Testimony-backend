// src/controllers/userController.js

import asyncHandler from "express-async-handler";
import crypto from "crypto";
import {
  getUserById,
  getCurrentUserService,
  updateUserProfile,
  updateUserPreferences,
  updateUserSettings,
  deleteUserAccount,
  exportUserData,
  initiatePasswordReset,
  performPasswordReset,
  uploadProfilePicture,
  reactivateUserAccount,
} from "../services/userService.js";
import {
  validateUpdateData,
  validatePasswordResetData,
  validateTwoFactorData,
  validateProfilePicture,
} from "../utils/validators.js";
import { logger } from "../utils/logger.js";
import AppError from "../utils/appError.js";
import { profileUpdateRateLimiter } from "../middlewares/rateLimiter.js";
import { cache } from "../middlewares/cache.js";
import { sanitizeInput } from "../utils/validation.js";
import User from "../models/User.js";
import Skill from "../models/Skills.js";
import {
  disableTwoFactorAuth,
  enableTwoFactorAuth,
} from "../services/twoFactorService.js"; // Import twoFactorService
import userService from "../services/userService.js";
import emailService from "../services/emailService.js";
import { logUserActivity } from "../services/activityLogService.js";

/**
 * Get current logged in user
 */
export const getMe = asyncHandler(async (req, res, next) => {
  const user = await getCurrentUserService(req.user.id);

  if (!user) {
    throw new AppError("User not found", 404);
  }

  res.status(200).json({
    success: true,
    data: user,
  });
});

/**
 * Get user profile with preferences and settings
 */
export const getUserProfile = asyncHandler(async (req, res, next) => {
  const user = await getUserById(req.user.id);
  if (!user) {
    return next(new AppError("User not found", 404));
  }
  res.status(200).json({
    success: true,
    data: user,
  });
});

/**
 * Update user profile with rate limiting, caching, and two-factor authentication validation
 */
export const updateUserProfileController = asyncHandler(
  async (req, res, next) => {
    // Rate limiting to prevent abuse
    await profileUpdateRateLimiter(req, res, next);

    // Sanitize input data
    const sanitizedData = {};
    Object.keys(req.body).forEach((key) => {
      if (typeof req.body[key] === "string") {
        sanitizedData[key] = sanitizeInput(req.body[key]);
      } else {
        sanitizedData[key] = req.body[key];
      }
    });

    // Validate sanitized data
    const validationErrors = validateUpdateData(sanitizedData);
    if (validationErrors.length > 0) {
      throw new AppError("Validation failed", 400, validationErrors);
    }

    // Validate two-factor authentication data if provided
    if (sanitizedData.twoFactor) {
      validateTwoFactorData(sanitizedData.twoFactor);
    }

    // Check cache for existing profile data
    const cachedProfile = await cache.get(`user_profile_${req.user.id}`);
    if (cachedProfile) {
      logger.info(`User profile retrieved from cache: ${req.user.id}`);
      return res.status(200).json({
        success: true,
        data: cachedProfile,
        message: "Profile fetched from cache.",
      });
    }

    // Proceed with updating the user profile
    const updatedUserProfile = await userService.updateUserProfile(
      req.user.id,
      sanitizedData
    );

    if (!updatedUserProfile) {
      throw new AppError("User not found or update failed", 404);
    }

    // Update cache with new profile data
    await cache.set(`user_profile_${req.user.id}`, updatedUserProfile, 300); // Cache for 5 minutes

    logger.info(`User profile updated: ${req.user.id}`);

    // Log the profile update activity
    await logUserActivity(req.user.id, "UPDATE_PROFILE");

    res.status(200).json({
      success: true,
      data: updatedUserProfile,
      message: "Profile updated successfully.",
    });
  }
);

/**
 * Update user preferences
 */
export const updatePreferences = asyncHandler(async (req, res, next) => {
  const preferences = await updateUserPreferences(req.user.id, req.body);

  res.status(200).json({
    success: true,
    data: preferences,
    message: "Preferences updated successfully",
  });
});

/**
 * Update user settings
 */
export const updateSettings = asyncHandler(async (req, res, next) => {
  const settings = await updateUserSettings(req.user.id, req.body);

  res.status(200).json({
    success: true,
    data: settings,
    message: "Settings updated successfully",
  });
});

/**
 * Delete user account (GDPR "Right to be Forgotten")
 */
export const deleteAccount = asyncHandler(async (req, res, next) => {
  await deleteUserAccount(req.user.id);

  res.status(200).json({
    success: true,
    message: "Account deleted successfully",
  });
});

/**
 * Export user data (GDPR)
 */
export const exportData = asyncHandler(async (req, res, next) => {
  const data = await exportUserData(req.user.id);

  res.setHeader("Content-Disposition", "attachment; filename=user_data.json");
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(JSON.stringify(data, null, 2));
});

/**
 * Initiate password reset
 */
export const forgotPassword = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    throw new AppError("Email is required", 400);
  }

  await initiatePasswordReset(email);

  res.status(200).json({
    success: true,
    message: "Password reset instructions sent to your email.",
  });
});

/**
 * Complete password reset
 */
export const performPasswordResetController = asyncHandler(
  async (req, res, next) => {
    const { token, newPassword } = req.body;

    // Validate input
    const validationErrors = validatePasswordResetData({ token, newPassword });
    if (validationErrors.length > 0) {
      throw new AppError("Validation failed", 400, validationErrors);
    }

    // Proceed with password reset
    await resetPassword(token, newPassword);

    logger.info(`Password reset for user: ${req.user.id}`);

    res.status(200).json({
      success: true,
      message: "Password has been reset successfully.",
    });
  }
);

/**
 * Enable Two-Factor Authentication
 */
export const enable2FA = asyncHandler(async (req, res, next) => {
  const { method } = req.body;

  if (!["sms", "authenticator"].includes(method)) {
    throw new AppError("Invalid 2FA method", 400);
  }

  const result = await enableTwoFactorAuth(req.user.id, method);

  if (!result.success) {
    throw new AppError(result.message, 400);
  }

  res.status(200).json({
    success: true,
    message: "Two-Factor Authentication enabled successfully.",
  });
});

/**
 * Disable Two-Factor Authentication
 */
export const disable2FA = asyncHandler(async (req, res, next) => {
  const { code } = req.body;

  if (!code) {
    throw new AppError("Verification code is required to disable 2FA", 400);
  }

  const result = await disableTwoFactorAuth(req.user.id, code);

  if (!result.success) {
    throw new AppError(result.message, 400);
  }

  res.status(200).json({
    success: true,
    message: "Two-Factor Authentication disabled successfully.",
  });
});

/**
 * Upload profile picture with validation
 */
export const uploadProfilePic = asyncHandler(async (req, res, next) => {
  if (!req.file) {
    throw new AppError("No file uploaded", 400);
  }

  validateProfilePicture(req.file);

  const imageUrl = await uploadProfilePicture(
    req.user.id,
    req.file.buffer,
    req.file.mimetype
  );

  res.status(200).json({
    success: true,
    data: { profilePicture: imageUrl },
    message: "Profile picture uploaded successfully.",
  });
});

/**
 * Add a new skill
 * @route   POST /api/v1/skills
 * @access  Private (Seeker)
 */
export const addSkill = asyncHandler(async (req, res, next) => {
  const { name, category } = req.body;

  if (!name || !category) {
    throw new AppError("Skill name and category are required", 400);
  }

  const newSkill = await Skill.create({
    seeker: req.user.id,
    name,
    category,
  });

  res.status(201).json({
    success: true,
    data: newSkill,
    message: "Skill added successfully",
  });
});

/**
 * Delete User Account
 * @route   DELETE /api/v1/users/profile
 * @access  Protected
 */
export const deleteUserAccountHandler = asyncHandler(async (req, res, next) => {
  await deleteUserAccount(req.user.id);

  res.status(200).json({
    success: true,
    message: "User account deleted successfully.",
  });
});

/**
 * Initiate Password Reset
 * @route   POST /api/v1/users/password-reset
 * @access  Public
 */
export const initiatePasswordResetHandler = asyncHandler(
  async (req, res, next) => {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("No user found with this email", 404);
    }

    const resetToken = user.generateResetPasswordToken();
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.resetPasswordExpiry = Date.now() + 3600000; // 1 hour

    await user.save({ validateBeforeSave: false });

    await emailService.sendPasswordResetEmail(user.email, resetToken);

    res.status(200).json({
      success: true,
      message: "Password reset link sent to your email.",
    });
  }
);

/**
 * Complete Password Reset
 * @route   POST /api/v1/users/password-reset/:token
 * @access  Public
 */
export const completePasswordResetHandler = asyncHandler(
  async (req, res, next) => {
    const { token } = req.params;
    const { newPassword } = req.body;

    const user = await userService.completePasswordReset(token, newPassword);
    if (!user) {
      throw new AppError("Invalid or expired reset token", 400);
    }

    res.status(200).json({
      success: true,
      message: "Password reset successful.",
    });
  }
);

/**
 * Deactivate User Account
 * @route   POST /api/v1/users/deactivate
 * @access  Protected
 */
export const deactivateUserAccountHandler = asyncHandler(
  async (req, res, next) => {
    await deactivateUserAccount(req.user.id);

    res.status(200).json({
      success: true,
      message: "User account deactivated successfully.",
    });
  }
);

/**
 * Reactivate User Account
 * @route   POST /api/v1/users/reactivate
 * @access  Protected
 */
export const reactivateUserAccountHandler = asyncHandler(
  async (req, res, next) => {
    await reactivateUserAccount(req.user.id);

    res.status(200).json({
      success: true,
      message: "User account reactivated successfully.",
    });
  }
);

export const setupTwoFactorAuth = asyncHandler(async (req, res, next) => {
  const { user } = req;

  // ...existing setup logic...

  // Log activity
  await ActivityLog.create({
    user: user._id,
    action: "TWO_FACTOR_SETUP_INITIATED",
    metadata: {
      method: "TOTP",
    },
  });

  res.status(200).json({
    success: true,
    data: {
      otpauth_url,
      qrCode,
      backupCodes,
    },
    message: "Two-factor authentication setup initiated.",
  });
});

/**
 * Enable Two-Factor Authentication after verification
 */
export const enableTwoFactorAuthController = asyncHandler(
  async (req, res, next) => {
    const { token } = req.body;
    const { user } = req;

    await verifyTOTPToken(user.id, token);

    user.isTwoFactorEnabled = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Two-factor authentication enabled successfully.",
    });
  }
);

/**
 * Disable Two-Factor Authentication
 */
export const disableTwoFactorAuthController = asyncHandler(
  async (req, res, next) => {
    const { token } = req.body;
    const { user } = req;

    try {
      // First, try verifying TOTP token
      await verifyTOTPToken(user.id, token);
    } catch {
      // If TOTP verification fails, try backup code
      await verifyBackupCode(user.id, token);
    }

    user.isTwoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    user.twoFactorBackupCodes = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Two-factor authentication disabled successfully.",
    });
  }
);
