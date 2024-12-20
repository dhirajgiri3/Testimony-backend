// src/controllers/authController.js

import asyncHandler from 'express-async-handler';
import crypto from 'crypto';
import User from '../models/User.js';
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../services/emailService.js';
import { twoFactorService } from '../services/twoFactorService.js';
import { createError, createValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import {
  generateAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  verifyRefreshToken,
} from '../services/tokenService.js';
import {
  validatePasswordStrength,
  normalizePhoneNumber,
} from '../utils/inputValidation.js';
import AppError from '../utils/appError.js';
import {
  setupTwoFactorAuth,
  enableTwoFactorAuth,
  disableTwoFactorAuth,
} from '../services/twoFactorService.js';
import { sendOTP, verifyOTP } from '../services/smsService.js';
import { logUserActivity } from '../services/activityLogService.js';

/**
 * Register a new user
 */
export const register = asyncHandler(async (req, res, next) => {
  const {
    firstName,
    lastName,
    email,
    username,
    password,
    confirmPassword,
    phone,
  } = req.body;

  // Validate required fields
  if (
    !firstName ||
    !lastName ||
    !email ||
    !username ||
    !password ||
    !confirmPassword
  ) {
    throw new AppError('All fields are required', 400);
  }

  // Check if passwords match
  if (password !== confirmPassword) {
    throw new AppError('Passwords do not match', 400);
  }

  // Validate password strength
  validatePasswordStrength(password);

  // Check if user already exists
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new AppError('Email already in use', 400);
  }

  // Normalize phone number if provided
  const normalizedPhone = phone ? normalizePhoneNumber(phone) : undefined;

  // Create new user
  const user = new User({
    firstName,
    lastName,
    email: email.toLowerCase(),
    username,
    password,
    phone: normalizedPhone,
  });

  await user.save();

  // Generate email verification token
  const verificationToken = user.generateEmailVerificationToken();
  await user.save();

  // Send verification email
  await sendVerificationEmail(user.email, verificationToken);

  // Log registration activity
  await logUserActivity(user.id, 'REGISTER');

  res.status(201).json({
    success: true,
    message: 'User registered successfully. Please verify your email.',
  });
});

/**
 * Verify user's email
 */
export const verifyEmail = asyncHandler(async (req, res, next) => {
  const { token } = req.params;

  if (!token) {
    throw new AppError('Verification token is missing', 400);
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationTokenExpiry: { $gt: Date.now() },
  });

  if (!user) {
    throw new AppError('Invalid or expired verification token', 400);
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationTokenExpiry = undefined;
  await user.save();

  // Log email verification activity
  await logUserActivity(user.id, 'VERIFY_EMAIL');

  res.status(200).json({
    success: true,
    message: 'Email verified successfully. You can now log in.',
  });
});

/**
 * Resend verification email
 */
export const resendVerificationEmail = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.isEmailVerified) {
    throw new AppError('Email is already verified', 400);
  }

  // Generate new verification token
  const verificationToken = user.generateEmailVerificationToken();
  await user.save();

  // Send verification email
  await sendVerificationEmail(user.email, verificationToken);

  // Log resend verification activity
  await logUserActivity(user.id, 'RESEND_VERIFICATION_EMAIL');

  res.status(200).json({
    success: true,
    message: 'Verification email resent successfully.',
  });
});

/**
 * Login user
 */
export const login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  // Validate email and password presence
  if (!email || !password) {
    throw new AppError('Please provide email and password', 400);
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    '+password'
  );

  if (!user || !(await user.matchPassword(password))) {
    throw new AppError('Invalid email or password', 401);
  }

  if (!user.isEmailVerified) {
    throw new AppError('Please verify your email to log in', 401);
  }

  // Check if account is locked
  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    throw new AppError('Account is locked. Please try again later.', 403);
  }

  // Reset login attempts on successful login
  user.loginAttempts = 0;
  user.lockedUntil = undefined;
  await user.save();

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Set tokens in HTTP-only cookies
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  // Log login activity
  await logUserActivity(user.id, 'LOGIN');

  // If 2FA is enabled, generate and send code
  if (user.isTwoFactorEnabled) {
    await twoFactorService.generateTwoFactorCode(user.id);
    return res.status(200).json({
      success: true,
      message: 'Two-factor authentication code sent to your authenticator app.',
      requires2FA: true,
    });
  }

  res.status(200).json({
    success: true,
    message: 'Logged in successfully.',
  });
});

/**
 * Verify 2FA code
 */
export const verifyTwoFactor = asyncHandler(async (req, res, next) => {
  const { userId, code } = req.body;

  if (!userId || !code) {
    throw new AppError('User ID and code are required', 400);
  }

  await twoFactorService.verifyTwoFactorCode(userId, code);

  // Set a flag in the session indicating 2FA is completed
  req.session.isTwoFactorAuthenticated = true;

  // Log 2FA verification activity
  await logUserActivity(userId, 'VERIFY_2FA');

  res.status(200).json({
    success: true,
    message: 'Two-factor authentication successful.',
  });
});

/**
 * Refresh access token
 */
export const refreshTokenController = asyncHandler(async (req, res, next) => {
  const refreshToken = req.cookies?.refresh_token;

  if (!refreshToken) {
    throw new AppError('Refresh token missing', 401);
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);

    const user = await User.findById(decoded.id);

    if (!user) {
      throw new AppError('User not found', 401);
    }

    // Check if token version matches
    if (decoded.tokenVersion !== user.tokenVersion) {
      throw new AppError('Token has been revoked', 401);
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user);

    // Optionally, rotate refresh token
    const newRefreshToken = rotateRefreshToken(user);

    // Set new tokens in cookies
    res.cookie('access_token', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Log token refresh activity
    await logUserActivity(user.id, 'REFRESH_TOKEN');

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully.',
    });
  } catch (error) {
    logger.error('Refresh token error:', { error: error.message });
    throw new AppError('Invalid or expired refresh token', 401);
  }
});

/**
 * Logout user
 */
export const logout = asyncHandler(async (req, res, next) => {
  const refreshToken = req.cookies?.refresh_token;

  if (refreshToken) {
    // Rotate refresh token to blacklist the current one
    await rotateRefreshToken(null, true, refreshToken);
  }

  // Clear cookies
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');

  // Log logout activity
  if (req.user && req.user.id) {
    await logUserActivity(req.user.id, 'LOGOUT');
  }

  res.status(200).json({
    success: true,
    message: 'Logged out successfully.',
  });
});

/**
 * Forgot Password - Initiate reset
 */
export const forgotPassword = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    throw new AppError('Email is required', 400);
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new AppError('User with this email does not exist', 404);
  }

  // Generate password reset token
  const resetToken = user.generatePasswordResetToken();
  await user.save();

  // Send password reset email
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
  await sendPasswordResetEmail(user.email, resetUrl);

  // Log password reset request
  await logUserActivity(user.id, 'REQUEST_PASSWORD_RESET');

  res.status(200).json({
    success: true,
    message: 'Password reset email sent successfully.',
  });
});

/**
 * Reset Password - Complete reset
 */
export const resetPasswordController = asyncHandler(async (req, res, next) => {
  const { token, newPassword, confirmPassword } = req.body;

  if (!token || !newPassword || !confirmPassword) {
    throw new AppError('All fields are required', 400);
  }

  if (newPassword !== confirmPassword) {
    throw new AppError('Passwords do not match', 400);
  }

  // Validate password strength
  validatePasswordStrength(newPassword);

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpiry: { $gt: Date.now() },
  });

  if (!user) {
    throw new AppError('Invalid or expired password reset token', 400);
  }

  user.password = newPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpiry = undefined;
  user.tokenVersion += 1; // Invalidate existing refresh tokens
  await user.save();

  // Log password reset activity
  await logUserActivity(user.id, 'RESET_PASSWORD');

  res.status(200).json({
    success: true,
    message:
      'Password reset successfully. You can now log in with your new password.',
  });
});

/**
 * Send phone OTP for verification
 * @route POST /api/auth/send-otp
 */
export const sendPhoneOTP = asyncHandler(async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    throw new AppError('Phone number is required', 400);
  }

  // Normalize and validate phone number
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) {
    throw new AppError('Invalid phone number format', 400);
  }

  try {
    // Use smsService to send OTP
    const result = await sendOTP(normalizedPhone);

    logger.info(`OTP sent successfully to phone: ${normalizedPhone.slice(-4)}`);

    // Log OTP send activity
    await logUserActivity(req.user.id, 'SEND_PHONE_OTP');

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      expiresIn: result.expiresIn * 60, // Convert minutes to seconds
    });
  } catch (error) {
    logger.error(`Failed to send OTP: ${error.message}`);
    throw new AppError(error.message || 'Failed to send OTP', 500);
  }
});

/**
 * Verify phone OTP
 * @route POST /api/auth/verify-otp
 */
export const verifyPhoneOTP = asyncHandler(async (req, res, next) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    throw new AppError('Phone number and code are required', 400);
  }

  // Normalize phone number
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) {
    throw new AppError('Invalid phone number format', 400);
  }

  try {
    // Use smsService to verify OTP
    const isValid = await verifyOTP(normalizedPhone, code);

    if (!isValid) {
      throw new AppError('Invalid or expired OTP', 400);
    }

    // Update user's phone verification status if needed
    const user = await User.findOneAndUpdate(
      { phone: normalizedPhone },
      {
        isPhoneVerified: true,
        phoneVerifiedAt: new Date(),
      },
      { new: true }
    );

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Log OTP verification activity
    await logUserActivity(user.id, 'VERIFY_PHONE_OTP');

    res.status(200).json({
      success: true,
      message: 'Phone number verified successfully',
      isVerified: true,
    });
  } catch (error) {
    logger.error(`OTP verification failed: ${error.message}`);
    throw new AppError(error.message || 'Verification failed', 400);
  }
});

/**
 * Enable Two-Factor Authentication
 */
export const enableTwoFactorAuthController = asyncHandler(
  async (req, res, next) => {
    const { token } = req.body;
    const { user } = req;

    if (!token) {
      throw new AppError('Verification token is required', 400);
    }

    const result = await enableTwoFactorAuth(user.id, token);

    if (!result.success) {
      throw new AppError(result.message, 400);
    }

    // Log 2FA enable activity
    await logUserActivity(user.id, 'ENABLE_2FA');

    res.status(200).json({
      success: true,
      message: 'Two-factor authentication enabled successfully.',
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

    if (!token) {
      throw new AppError('Verification token is required to disable 2FA', 400);
    }

    const result = await disableTwoFactorAuth(user.id, token);

    if (!result.success) {
      throw new AppError(result.message, 400);
    }

    // Log 2FA disable activity
    await logUserActivity(user.id, 'DISABLE_2FA');

    res.status(200).json({
      success: true,
      message: 'Two-factor authentication disabled successfully.',
    });
  }
);

/**
 * Upload profile picture with validation
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
    await logUserActivity(req.user.id, 'UPLOAD_PROFILE_PIC');

    res.status(200).json({
      success: true,
      data: { profilePicture: imageUrl },
      message: 'Profile picture uploaded successfully.',
    });
  } catch (error) {
    logger.error('Profile picture upload failed:', { error: error.message });
    throw new AppError('Failed to upload profile picture', 500);
  }
});

/**
 * Logout user (Additional Logout Logic if Needed)
 * Optional: Implementing session invalidation or additional cleanup if necessary
 */

export default {
  register,
  verifyEmail,
  resendVerificationEmail,
  login,
  verifyTwoFactor,
  refreshTokenController,
  logout,
  forgotPassword,
  resetPasswordController,
  sendPhoneOTP,
  verifyPhoneOTP,
  enableTwoFactorAuthController,
  disableTwoFactorAuthController,
  uploadProfilePic,
};
