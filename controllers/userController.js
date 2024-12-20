// src/controllers/userController.js

import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import Skill from '../models/Skill.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
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
} from '../services/userService.js';
import {
  validateUpdateData,
  validatePasswordResetData,
  validateTwoFactorData,
  validateProfilePicture,
} from '../utils/validators.js';
import { profileUpdateRateLimiter } from '../middlewares/rateLimiter.js';
import { cache } from '../middlewares/cache.js';
import { sanitizeInput } from '../utils/validation.js';
import {
  disableTwoFactorAuth,
  enableTwoFactorAuth,
} from '../services/twoFactorService.js';
import emailService from '../services/emailService.js';
import { logUserActivity } from '../services/activityLogService.js';

/**
 * Get current logged in user
 * @route GET /api/v1/users/me
 * @access Private
 */
export const getMe = asyncHandler(async (req, res, next) => {
  const user = await getCurrentUserService(req.user.id);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.status(200).json({
    success: true,
    data: user,
  });
});

/**
 * Get user profile with preferences and settings
 * @route GET /api/v1/users/profile
 * @access Private
 */
export const getUserProfile = asyncHandler(async (req, res, next) => {
  const user = await getUserById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404);
  }
  res.status(200).json({
    success: true,
    data: user,
  });
});

/**
 * Update user profile with rate limiting, caching, and two-factor authentication validation
 * @route PUT /api/v1/users/profile
 * @access Private
 */
export const updateUserProfileController = asyncHandler(
  async (req, res, next) => {
    // Apply rate limiting to prevent abuse
    await profileUpdateRateLimiter(req, res, next);

    // Sanitize input data
    const sanitizedData = {};
    Object.keys(req.body).forEach((key) => {
      if (typeof req.body[key] === 'string') {
        sanitizedData[key] = sanitizeInput(req.body[key]);
      } else {
        sanitizedData[key] = req.body[key];
      }
    });

    // Validate sanitized data
    const validationErrors = validateUpdateData(sanitizedData);
    if (validationErrors.length > 0) {
      throw new AppError('Validation failed', 400, validationErrors);
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
        message: 'Profile fetched from cache.',
      });
    }

    try {
      // Proceed with updating the user profile
      const updatedUserProfile = await updateUserProfile(
        req.user.id,
        sanitizedData
      );

      if (!updatedUserProfile) {
        throw new AppError('User not found or update failed', 404);
      }

      // Update cache with new profile data
      await cache.set(`user_profile_${req.user.id}`, updatedUserProfile, 300); // Cache for 5 minutes

      // Log profile update activity
      await logUserActivity(req.user.id, 'UPDATE_PROFILE');

      res.status(200).json({
        success: true,
        data: updatedUserProfile,
        message: 'Profile updated successfully.',
      });
    } catch (error) {
      logger.error('❌ Error updating user profile:', { error: error.message });
      throw new AppError('Failed to update profile', 500);
    }
  }
);

/**
 * Update user preferences
 * @route PUT /api/v1/users/preferences
 * @access Private
 */
export const updatePreferences = asyncHandler(async (req, res, next) => {
  try {
    const preferences = await updateUserPreferences(req.user.id, req.body);

    // Log preferences update activity
    await logUserActivity(req.user.id, 'UPDATE_PREFERENCES');

    res.status(200).json({
      success: true,
      data: preferences,
      message: 'Preferences updated successfully',
    });
  } catch (error) {
    logger.error('❌ Error updating preferences:', { error: error.message });
    throw new AppError('Failed to update preferences', 500);
  }
});

/**
 * Update user settings
 * @route PUT /api/v1/users/settings
 * @access Private
 */
export const updateSettings = asyncHandler(async (req, res, next) => {
  try {
    const settings = await updateUserSettings(req.user.id, req.body);

    // Log settings update activity
    await logUserActivity(req.user.id, 'UPDATE_SETTINGS');

    res.status(200).json({
      success: true,
      data: settings,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    logger.error('❌ Error updating settings:', { error: error.message });
    throw new AppError('Failed to update settings', 500);
  }
});

/**
 * Delete user account (GDPR "Right to be Forgotten")
 * @route DELETE /api/v1/users/account
 * @access Private
 */
export const deleteAccount = asyncHandler(async (req, res, next) => {
  try {
    await deleteUserAccount(req.user.id);

    // Log account deletion activity
    await logUserActivity(req.user.id, 'DELETE_ACCOUNT');

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    logger.error('❌ Error deleting account:', { error: error.message });
    throw new AppError('Failed to delete account', 500);
  }
});

/**
 * Export user data (GDPR)
 * @route GET /api/v1/users/export
 * @access Private
 */
export const exportData = asyncHandler(async (req, res, next) => {
  try {
    const data = await exportUserData(req.user.id);

    // Log data export activity
    await logUserActivity(req.user.id, 'EXPORT_USER_DATA');

    res.setHeader('Content-Disposition', 'attachment; filename=user_data.json');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(JSON.stringify(data, null, 2));
  } catch (error) {
    logger.error('❌ Error exporting user data:', { error: error.message });
    throw new AppError('Failed to export user data', 500);
  }
});

/**
 * Initiate password reset
 * @route POST /api/v1/users/password-reset
 * @access Public
 */
export const initiatePasswordResetHandler = asyncHandler(
  async (req, res, next) => {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        throw new AppError('No user found with this email', 404);
      }

      const resetToken = user.generateResetPasswordToken();
      user.resetPasswordToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');
      user.resetPasswordExpiry = Date.now() + 3600000; // 1 hour

      await user.save({ validateBeforeSave: false });

      await emailService.sendPasswordResetEmail(user.email, resetToken);

      // Log password reset initiation activity
      await logUserActivity(user.id, 'INITIATE_PASSWORD_RESET');

      res.status(200).json({
        success: true,
        message: 'Password reset link sent to your email.',
      });
    } catch (error) {
      logger.error('❌ Error initiating password reset:', {
        error: error.message,
      });
      throw new AppError('Failed to initiate password reset', 500);
    }
  }
);

/**
 * Complete password reset
 * @route POST /api/v1/users/password-reset/:token
 * @access Public
 */
export const completePasswordResetController = asyncHandler(
  async (req, res, next) => {
    const { token } = req.params;
    const { newPassword, confirmPassword } = req.body;

    if (!token || !newPassword || !confirmPassword) {
      throw new AppError('All fields are required', 400);
    }

    if (newPassword !== confirmPassword) {
      throw new AppError('Passwords do not match', 400);
    }

    // Validate password strength
    validatePasswordStrength(newPassword);

    try {
      const user = await performPasswordReset(token, newPassword);

      if (!user) {
        throw new AppError('Invalid or expired reset token', 400);
      }

      // Log password reset activity
      await logUserActivity(user.id, 'COMPLETE_PASSWORD_RESET');

      res.status(200).json({
        success: true,
        message: 'Password reset successful.',
      });
    } catch (error) {
      logger.error('❌ Error completing password reset:', {
        error: error.message,
      });
      throw new AppError('Failed to complete password reset', 500);
    }
  }
);

/**
 * Deactivate User Account
 * @route POST /api/v1/users/deactivate
 * @access Private
 */
export const deactivateUserAccountHandler = asyncHandler(
  async (req, res, next) => {
    try {
      await deactivateUserAccount(req.user.id);

      // Log account deactivation activity
      await logUserActivity(req.user.id, 'DEACTIVATE_ACCOUNT');

      res.status(200).json({
        success: true,
        message: 'User account deactivated successfully.',
      });
    } catch (error) {
      logger.error('❌ Error deactivating user account:', {
        error: error.message,
      });
      throw new AppError('Failed to deactivate user account', 500);
    }
  }
);

/**
 * Reactivate User Account
 * @route POST /api/v1/users/reactivate
 * @access Private
 */
export const reactivateUserAccountHandler = asyncHandler(
  async (req, res, next) => {
    try {
      await reactivateUserAccount(req.user.id);

      // Log account reactivation activity
      await logUserActivity(req.user.id, 'REACTIVATE_ACCOUNT');

      res.status(200).json({
        success: true,
        message: 'User account reactivated successfully.',
      });
    } catch (error) {
      logger.error('❌ Error reactivating user account:', {
        error: error.message,
      });
      throw new AppError('Failed to reactivate user account', 500);
    }
  }
);

/**
 * Enable Two-Factor Authentication Setup
 * @route POST /api/v1/users/2fa/setup
 * @access Private
 */
export const setupTwoFactorAuth = asyncHandler(async (req, res, next) => {
  try {
    const { otpauth_url, qrCode, backupCodes } = await setupTwoFactorAuth(
      req.user.id
    );

    // Log 2FA setup initiation
    await logUserActivity(req.user.id, 'SETUP_2FA_INITIATED');

    res.status(200).json({
      success: true,
      data: {
        otpauth_url,
        qrCode,
        backupCodes,
      },
      message: 'Two-factor authentication setup initiated.',
    });
  } catch (error) {
    logger.error('❌ Error setting up two-factor authentication:', {
      error: error.message,
    });
    throw new AppError(
      'Failed to initiate two-factor authentication setup',
      500
    );
  }
});

/**
 * Enable Two-Factor Authentication after verification
 * @route POST /api/v1/users/2fa/enable
 * @access Private
 */
export const enableTwoFactorAuthController = asyncHandler(
  async (req, res, next) => {
    const { token } = req.body;

    if (!token) {
      throw new AppError('Verification token is required', 400);
    }

    try {
      await enableTwoFactorAuth(req.user.id, token);

      // Log 2FA enable activity
      await logUserActivity(req.user.id, 'ENABLE_2FA');

      res.status(200).json({
        success: true,
        message: 'Two-factor authentication enabled successfully.',
      });
    } catch (error) {
      logger.error('❌ Error enabling two-factor authentication:', {
        error: error.message,
      });
      throw new AppError('Failed to enable two-factor authentication', 500);
    }
  }
);

/**
 * Disable Two-Factor Authentication
 * @route POST /api/v1/users/2fa/disable
 * @access Private
 */
export const disableTwoFactorAuthController = asyncHandler(
  async (req, res, next) => {
    const { token } = req.body;

    if (!token) {
      throw new AppError('Verification token is required to disable 2FA', 400);
    }

    try {
      await disableTwoFactorAuth(req.user.id, token);

      // Log 2FA disable activity
      await logUserActivity(req.user.id, 'DISABLE_2FA');

      res.status(200).json({
        success: true,
        message: 'Two-factor authentication disabled successfully.',
      });
    } catch (error) {
      logger.error('❌ Error disabling two-factor authentication:', {
        error: error.message,
      });
      throw new AppError('Failed to disable two-factor authentication', 500);
    }
  }
);

/**
 * Upload profile picture with validation
 * @route POST /api/v1/users/profile-picture
 * @access Private
 */
export const uploadProfilePic = asyncHandler(async (req, res, next) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  // Validate profile picture
  validateProfilePicture(req.file);

  try {
    const imageUrl = await uploadProfilePicture(
      req.user.id,
      req.file.buffer,
      req.file.mimetype
    );

    // Log profile picture upload activity
    await logUserActivity(req.user.id, 'UPLOAD_PROFILE_PICTURE');

    res.status(200).json({
      success: true,
      data: { profilePicture: imageUrl },
      message: 'Profile picture uploaded successfully.',
    });
  } catch (error) {
    logger.error('❌ Error uploading profile picture:', {
      error: error.message,
    });
    throw new AppError('Failed to upload profile picture', 500);
  }
});

export default {
  getMe,
  getUserProfile,
  updateUserProfileController,
  updatePreferences,
  updateSettings,
  deleteAccount,
  exportData,
  initiatePasswordResetHandler,
  completePasswordResetController,
  deactivateUserAccountHandler,
  reactivateUserAccountHandler,
  setupTwoFactorAuth,
  enableTwoFactorAuthController,
  disableTwoFactorAuthController,
  uploadProfilePic,
};
