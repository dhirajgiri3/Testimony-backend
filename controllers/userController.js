import asyncHandler from "express-async-handler";
import {
  getUserById,
  getCurrentUserService,
  updateUserProfile,
  updateUserPreferences,
  updateUserSettings,
  deleteUserAccount,
  exportUserData,
  initiatePasswordReset,
  resetPassword,
  enableTwoFactorAuth,
  disableTwoFactorAuth,
  uploadProfilePicture,
} from "../services/userService.js";
import {
  validateUpdateData,
  validatePasswordResetData,
  validateTwoFactorData,
  validateProfilePicture,
} from "../utils/validators.js";
import { logger } from "../utils/logger.js";
import AppError from "../utils/appError.js";
import {
  profileUpdateRateLimiter,
  emailVerificationRateLimiter,
} from "../middlewares/rateLimiter.js";
import { cache } from "../middlewares/cache.js";

/**
 * @desc    Get current logged in user
 * @route   GET /api/v1/users/me
 * @access  Private
 */
export const getMe = [
  cache("user_me"),
  asyncHandler(async (req, res, next) => {
    const user = await getCurrentUserService(req.user.id);

    res.status(200).json({
      success: true,
      data: user,
    });
  }),
];

/**
 * @desc    Get user profile with preferences and settings
 * @route   GET /api/v1/users/profile
 * @access  Private
 */
export const getUserProfile = [
  cache("user_profile"),
  asyncHandler(async (req, res, next) => {
    const user = await getUserById(req.user.id);
    if (!user) {
      return next(new AppError("User not found", 404));
    }
    res.status(200).json({
      success: true,
      data: user,
    });
  }),
];

/**
 * @desc    Update user profile
 * @route   PUT /api/v1/users/update-profile
 * @access  Private
 */
export const updateProfile = [
  profileUpdateRateLimiter,
  asyncHandler(async (req, res, next) => {
    const validationErrors = validateUpdateData(req.body);
    if (validationErrors.length > 0) {
      throw new AppError("Validation failed", 400, validationErrors);
    }

    const user = await updateUserProfile(req.user.id, req.body);

    res.status(200).json({
      success: true,
      data: user,
      message: "Profile updated successfully",
    });
  }),
];

/**
 * @desc    Update user preferences
 * @route   PUT /api/v1/users/update-preferences
 * @access  Private
 */
export const updatePreferences = [
  profileUpdateRateLimiter,
  asyncHandler(async (req, res, next) => {
    const preferences = await updateUserPreferences(req.user.id, req.body);

    res.status(200).json({
      success: true,
      data: preferences,
      message: "Preferences updated successfully",
    });
  }),
];

/**
 * @desc    Update user settings
 * @route   PUT /api/v1/users/update-settings
 * @access  Private
 */
export const updateSettings = [
  profileUpdateRateLimiter,
  asyncHandler(async (req, res, next) => {
    const settings = await updateUserSettings(req.user.id, req.body);

    res.status(200).json({
      success: true,
      data: settings,
      message: "Settings updated successfully",
    });
  }),
];

/**
 * @desc    Delete user account (GDPR "Right to be Forgotten")
 * @route   DELETE /api/v1/users/delete-account
 * @access  Private
 */
export const deleteAccount = [
  emailVerificationRateLimiter,
  asyncHandler(async (req, res, next) => {
    await deleteUserAccount(req.user.id);

    res.status(200).json({
      success: true,
      message: "Account deleted successfully",
    });
  }),
];

/**
 * @desc    Export user data (GDPR)
 * @route   GET /api/v1/users/export-data
 * @access  Private
 */
export const exportData = [
  profileUpdateRateLimiter,
  asyncHandler(async (req, res, next) => {
    const data = await exportUserData(req.user.id);

    res.setHeader("Content-Disposition", "attachment; filename=user_data.json");
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(JSON.stringify(data, null, 2));
  }),
];

/**
 * @desc    Initiate password reset
 * @route   POST /api/v1/users/forgot-password
 * @access  Public
 */
export const forgotPassword = [
  asyncHandler(async (req, res, next) => {
    const { email } = req.body;

    if (!email) {
      throw new AppError("Email is required", 400);
    }

    await initiatePasswordReset(email);

    res.status(200).json({
      success: true,
      message: "Password reset instructions sent to your email.",
    });
  }),
];

/**
 * @desc    Complete password reset
 * @route   POST /api/v1/users/reset-password
 * @access  Public
 */
export const performPasswordReset = [
  asyncHandler(async (req, res, next) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      throw new AppError("Token and new password are required", 400);
    }

    await resetPassword(token, newPassword);

    res.status(200).json({
      success: true,
      message: "Password has been reset successfully.",
    });
  }),
];

/**
 * @desc    Enable Two-Factor Authentication
 * @route   POST /api/v1/users/enable-2fa
 * @access  Private
 */
export const enable2FA = [
  asyncHandler(async (req, res, next) => {
    const { method } = req.body;

    if (!["sms", "authenticator"].includes(method)) {
      throw new AppError("Invalid 2FA method", 400);
    }

    await enableTwoFactorAuth(req.user.id, method);

    res.status(200).json({
      success: true,
      message: "Two-Factor Authentication enabled successfully.",
    });
  }),
];

/**
 * @desc    Disable Two-Factor Authentication
 * @route   POST /api/v1/users/disable-2fa
 * @access  Private
 */
export const disable2FA = [
  asyncHandler(async (req, res, next) => {
    await disableTwoFactorAuth(req.user.id);

    res.status(200).json({
      success: true,
      message: "Two-Factor Authentication disabled successfully.",
    });
  }),
];

/**
 * @desc    Upload profile picture with validation
 * @route   POST /api/v1/users/upload-profile-picture
 * @access  Private
 */
export const uploadProfilePic = [
  profileUpdateRateLimiter,
  asyncHandler(async (req, res, next) => {
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
  }),
];
