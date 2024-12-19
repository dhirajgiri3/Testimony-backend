// src/controllers/authController.js

import asyncHandler from "express-async-handler";
import User from "../models/User.js";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../services/emailService.js";
import { twoFactorService } from "../services/twoFactorService.js";
import { createError, createValidationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import {
  generateAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  verifyRefreshToken,
} from "../services/tokenService.js";
import {
  validatePasswordStrength,
  normalizePhoneNumber,
} from "../utils/inputValidation.js";
import AppError from "../utils/appError.js";
import { twoFactorService as twoFactor } from "../services/twoFactorService.js";
import {
  setupTwoFactorAuth,
  enableTwoFactorAuth,
  disableTwoFactorAuth
} from "../services/twoFactorService.js";
import { sendOTP, verifyOTP } from "../services/smsService.js";

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

  // Check if user already exists
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw createError("validation", "Email already in use", 400);
  }

  // Create new user
  const user = new User({
    firstName,
    lastName,
    email: email.toLowerCase(),
    username,
    password,
    phone: phone ? normalizePhoneNumber(phone) : undefined,
  });

  await user.save();

  // Generate email verification token
  const verificationToken = user.generateEmailVerificationToken();
  await user.save();

  // Send verification email
  await sendVerificationLink(user.email, verificationToken);

  res.status(201).json({
    success: true,
    message: "User registered successfully. Please verify your email.",
  });
});

/**
 * Verify user's email
 */
export const verifyEmail = asyncHandler(async (req, res, next) => {
  const { token } = req.params;

  if (!token) {
    throw createError("validation", "Verification token is missing", 400);
  }

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationTokenExpiry: { $gt: Date.now() },
  });

  if (!user) {
    throw createError(
      "validation",
      "Invalid or expired verification token",
      400
    );
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationTokenExpiry = undefined;
  await user.save();

  res.status(200).json({
    success: true,
    message: "Email verified successfully. You can now log in.",
  });
});

/**
 * Resend verification email
 */
export const resendVerificationEmail = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    throw createError("notFound", "User not found", 404);
  }

  if (user.isEmailVerified) {
    throw createError("validation", "Email is already verified", 400);
  }

  // Generate new verification token
  const verificationToken = user.generateEmailVerificationToken();
  await user.save();

  // Send verification email
  await sendVerificationLink(user.email, verificationToken);

  res.status(200).json({
    success: true,
    message: "Verification email resent successfully.",
  });
});

/**
 * Login user
 */
export const login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  // Validate email and password
  if (!email || !password) {
    throw createError("validation", "Please provide email and password", 400);
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+password"
  );

  if (!user || !(await user.matchPassword(password))) {
    throw createError("authentication", "Invalid email or password", 401);
  }

  if (!user.isEmailVerified) {
    throw createError(
      "authentication",
      "Please verify your email to log in",
      401
    );
  }

  // Check if account is locked
  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    throw createError(
      "authentication",
      "Account is locked. Please try again later.",
      403
    );
  }

  // Reset login attempts on successful login
  user.loginAttempts = 0;
  user.lockedUntil = undefined;
  await user.save();

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Set tokens in HTTP-only cookies
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

  // If 2FA is enabled, generate and send code
  if (user.isTwoFactorEnabled) {
    await twoFactorService.generateTwoFactorCode(user.id);
    return res.status(200).json({
      success: true,
      message: "Two-factor authentication code sent to your authenticator app.",
      requires2FA: true,
    });
  }

  res.status(200).json({
    success: true,
    message: "Logged in successfully.",
  });
});

/**
 * Verify 2FA code
 */
export const verifyTwoFactor = asyncHandler(async (req, res, next) => {
  const { userId, code } = req.body;

  if (!userId || !code) {
    throw createError("validation", "User ID and code are required", 400);
  }

  await twoFactor.verifyTwoFactorCode(userId, code);

  // Set a flag in the session indicating 2FA is completed
  req.session.isTwoFactorAuthenticated = true;

  res.status(200).json({
    success: true,
    message: "Two-factor authentication successful.",
  });
});

/**
 * Refresh access token
 */
export const refreshTokenController = asyncHandler(async (req, res, next) => {
  const refreshToken = req.cookies?.refresh_token;

  if (!refreshToken) {
    throw createError("authentication", "Refresh token missing", 401);
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);

    const user = await User.findById(decoded.id);

    if (!user) {
      throw createError("authentication", "User not found", 401);
    }

    // Check if token version matches
    if (decoded.tokenVersion !== user.tokenVersion) {
      throw createError("authentication", "Token has been revoked", 401);
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user);

    // Optionally, rotate refresh token
    const newRefreshToken = rotateRefreshToken(user);

    // Set new tokens in cookies
    res.cookie("access_token", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie("refresh_token", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      success: true,
      message: "Token refreshed successfully.",
    });
  } catch (error) {
    throw createError(
      "authentication",
      "Invalid or expired refresh token",
      401
    );
  }
});

/**
 * Logout user
 */
export const logout = asyncHandler(async (req, res, next) => {
  const refreshToken = req.cookies?.refresh_token;

  if (refreshToken) {
    // Blacklist the refresh token
    await rotateRefreshToken(req.user, true); // Assuming a flag to blacklist
  }

  // Clear cookies
  res.clearCookie("access_token");
  res.clearCookie("refresh_token");

  res.status(200).json({
    success: true,
    message: "Logged out successfully.",
  });
});

/**
 * Forgot Password - Initiate reset
 */
export const forgotPassword = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw createError("notFound", "User with this email does not exist", 404);
  }

  // Generate password reset token
  const resetToken = user.generatePasswordResetToken();
  await user.save();

  // Send password reset email
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
  await sendPasswordResetEmail(user.email, resetUrl);

  res.status(200).json({
    success: true,
    message: "Password reset email sent successfully.",
  });
});

/**
 * Reset Password - Complete reset
 */
export const resetPasswordController = asyncHandler(async (req, res, next) => {
  const { token, newPassword, confirmPassword } = req.body;

  if (!token || !newPassword || !confirmPassword) {
    throw createError("validation", "All fields are required", 400);
  }

  if (newPassword !== confirmPassword) {
    throw createError("validation", "Passwords do not match", 400);
  }

  // Validate password strength
  validatePasswordStrength(newPassword);

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpiry: { $gt: Date.now() },
  });

  if (!user) {
    throw createError(
      "validation",
      "Invalid or expired password reset token",
      400
    );
  }

  user.password = newPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpiry = undefined;
  user.tokenVersion += 1; // Invalidate existing refresh tokens
  await user.save();

  res.status(200).json({
    success: true,
    message:
      "Password reset successfully. You can now log in with your new password.",
  });
});

/**
 * Send phone OTP for verification
 * @route POST /api/auth/send-otp
 */
export const sendPhoneOTP = asyncHandler(async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    throw createError("validation", "Phone number is required", 400);
  }

  // Normalize and validate phone number
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) {
    throw createError("validation", "Invalid phone number format", 400);
  }

  // Rate limiting check (assuming it's implemented in middleware)
  if (req.rateLimit && req.rateLimit.remaining === 0) {
    throw createError("tooManyRequests", "Too many OTP requests. Please try again later", 429);
  }

  try {
    // Use smsService to send OTP
    const result = await sendOTP(normalizedPhone);

    logger.info(`OTP sent successfully to phone: ${normalizedPhone.slice(-4)}`);

    res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      expiresIn: result.expiresIn * 60 // Convert minutes to seconds
    });
  } catch (error) {
    logger.error(`Failed to send OTP: ${error.message}`);
    throw createError("serverError", error.message || "Failed to send OTP", 500);
  }
});

/**
 * Verify phone OTP
 * @route POST /api/auth/verify-otp
 */
export const verifyPhoneOTP = asyncHandler(async (req, res, next) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    throw createError("validation", "Phone number and code are required", 400);
  }

  // Normalize phone number
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) {
    throw createError("validation", "Invalid phone number format", 400);
  }

  try {
    // Use smsService to verify OTP
    const isValid = await verifyOTP(normalizedPhone, code);

    if (!isValid) {
      throw createError("validation", "Invalid or expired OTP", 400);
    }

    // Update user's phone verification status if needed
    const user = await User.findOneAndUpdate(
      { phone: normalizedPhone },
      {
        isPhoneVerified: true,
        phoneVerifiedAt: new Date()
      },
      { new: true }
    );

    if (!user) {
      throw createError("notFound", "User not found", 404);
    }

    // Log successful verification
    logger.info(`Phone verified successfully for user: ${user._id}`);

    res.status(200).json({
      success: true,
      message: "Phone number verified successfully",
      isVerified: true
    });
  } catch (error) {
    logger.error(`OTP verification failed: ${error.message}`);
    throw createError("validation", error.message || "Verification failed", 400);
  }
});
