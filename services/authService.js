// src/services/authService.js

import crypto from 'crypto';
import User from '../models/User.js';
import ActivityLog from '../models/ActivityLog.js';
import tokenService from './tokenService.js';
import emailService from './emailService.js';
import smsService from './smsService.js';
import AppError from '../utils/appError.js';
import { logger } from '../utils/logger.js';

/**
 * Registers a new user.
 *
 * @param {Object} userData - User registration data.
 * @returns {Promise<Object>} The created user and verification token.
 */
export const registerUser = async (userData) => {
  const { firstName, lastName, email, password, username, phone } = userData;

  // Check if email already exists
  const existingUser = await User.findOne({ email }).collation({
    locale: 'en',
    strength: 2,
  });
  if (existingUser) {
    throw new AppError('Email already in use', 400);
  }

  // Create new user
  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    username,
    phone,
  });

  // Generate email verification token
  const verificationToken = user.generateEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  logger.info(`New user registered: ${user.id}`);

  // Send verification email
  await emailService.sendVerificationEmail(user.email, verificationToken);

  // Log activity
  await ActivityLog.create({
    user: user._id,
    action: 'REGISTER',
    metadata: {
      ip: user.ipAddress || 'unknown',
      userAgent: user.userAgent || 'unknown',
    },
  });

  return { user, verificationToken };
};

/**
 * Logs in a user and generates access and refresh tokens.
 *
 * @param {Object} credentials - User login credentials.
 * @param {Object} req - Express request object for capturing metadata.
 * @returns {Promise<Object>} Access token, refresh token, and user data.
 */
export const loginUser = async (credentials, req) => {
  const { email, password, rememberMe } = credentials;

  // Find user by email
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.matchPassword(password))) {
    // Log failed login attempt
    if (user) {
      await ActivityLog.create({
        user: user._id,
        action: 'FAILED_LOGIN',
        metadata: {
          ip: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        },
      });
    }
    throw new AppError('Invalid email or password', 401);
  }

  // Check if email is verified
  if (!user.isEmailVerified) {
    throw new AppError('Please verify your email before logging in', 401);
  }

  // Generate tokens
  const { accessToken, refreshToken } = tokenService.generateTokens(user);

  // Log successful login
  await ActivityLog.create({
    user: user._id,
    action: 'LOGIN',
    metadata: {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    },
  });

  logger.info(`User logged in: ${user.id}`);

  return { accessToken, refreshToken, user };
};

/**
 * Logs out a user by blacklisting their tokens.
 *
 * @param {string} accessToken - User's access token.
 * @param {string} refreshToken - User's refresh token.
 * @returns {Promise<void>}
 */
export const logoutUser = async (accessToken, refreshToken) => {
  if (accessToken) {
    await tokenService.addToTokenBlacklist(accessToken);
  }
  if (refreshToken) {
    await tokenService.addToTokenBlacklist(refreshToken);
  }

  logger.info('User logged out and tokens blacklisted.');
};

/**
 * Refreshes access and refresh tokens using an existing refresh token.
 *
 * @param {string} oldRefreshToken - The existing refresh token.
 * @returns {Promise<Object>} New access token and refresh token.
 */
export const refreshTokens = async (oldRefreshToken) => {
  if (!oldRefreshToken) {
    throw new AppError('No refresh token provided', 401);
  }

  const { accessToken, refreshToken } = await tokenService.refreshTokens(
    oldRefreshToken
  );
  return { accessToken, refreshToken };
};

/**
 * Retrieves the current authenticated user's data.
 *
 * @param {string} userId - The user's ID.
 * @returns {Promise<Object>} The user data.
 */
export const getCurrentUser = async (userId) => {
  const user = await User.findById(userId).select('-password');
  if (!user) {
    throw new AppError('User not found', 404);
  }
  return user;
};

/**
 * Verifies a user's email using a verification token.
 *
 * @param {string} token - The email verification token.
 * @returns {Promise<Object>} The verified user.
 */
export const verifyEmail = async (token) => {
  if (!token) {
    throw new AppError('Verification token is required', 400);
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

  // Log email verification
  await ActivityLog.create({
    user: user._id,
    action: 'EMAIL_VERIFIED',
  });

  logger.info(`User email verified: ${user.id}`);

  return user;
};

/**
 * Resends the email verification link to the user.
 *
 * @param {string} userId - The user's ID.
 * @returns {Promise<Object>} The new verification token.
 */
export const resendVerificationEmail = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.isEmailVerified) {
    throw new AppError('Email is already verified', 400);
  }

  // Generate new verification token
  const verificationToken = user.generateEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  // Send verification email
  await emailService.sendVerificationEmail(user.email, verificationToken);

  // Log activity
  await ActivityLog.create({
    user: user._id,
    action: 'VERIFICATION_EMAIL_RESENT',
  });

  logger.info(`Verification email resent to user: ${user.id}`);

  return { verificationToken };
};

/**
 * Initiates a password reset process by sending a reset email.
 *
 * @param {string} email - The user's email address.
 * @param {Object} req - Express request object for capturing metadata.
 * @returns {Promise<void>}
 */
export const initiatePasswordReset = async (email, req) => {
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    '+twoFactorSecret +isTwoFactorEnabled'
  );

  if (!user) {
    // Always respond with success message to prevent user enumeration
    return;
  }

  // Generate reset token
  const resetToken = user.generateResetPasswordToken();
  user.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  user.resetPasswordExpiry = Date.now() + 3600000; // 1 hour

  await user.save({ validateBeforeSave: false });

  // Send reset email
  await emailService.sendPasswordResetEmail(user.email, resetToken);

  // Log the password reset request
  await ActivityLog.create({
    user: user._id,
    action: 'PASSWORD_RESET_REQUEST',
    metadata: {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    },
  });

  logger.info(`Password reset initiated for user: ${user.id}`);
};

/**
 * Completes the password reset process by setting a new password.
 *
 * @param {string} token - The password reset token.
 * @param {string} newPassword - The new password.
 * @returns {Promise<Object>} The updated user.
 */
export const completePasswordReset = async (token, newPassword) => {
  if (!token || !newPassword) {
    throw new AppError('Reset token and new password are required', 400);
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: tokenHash,
    resetPasswordExpiry: { $gt: Date.now() },
  });

  if (!user) {
    throw new AppError('Invalid or expired password reset token', 400);
  }

  user.password = newPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpiry = undefined;
  await user.save();

  // Log the password reset
  await ActivityLog.create({
    user: user.id,
    action: 'PASSWORD_RESET',
    metadata: {
      ip: user.lastLoginIP || 'Unknown',
      userAgent: user.lastLoginUserAgent || 'Unknown',
    },
  });

  logger.info(`Password reset successful for user: ${user.id}`);
  return user;
};

/**
 * Initiates a login with OTP by sending an OTP to the user's phone.
 *
 * @param {string} phone - The user's phone number.
 * @returns {Promise<void>}
 */
export const loginWithOTP = async (phone) => {
  const user = await User.findOne({ phone });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  await smsService.sendOTP(phone);

  // Log OTP request
  await ActivityLog.create({
    user: user._id,
    action: 'OTP_REQUESTED',
  });

  logger.info(`OTP sent to user: ${user.id}`);
};

/**
 * Verifies the OTP provided by the user during login.
 *
 * @param {string} phone - The user's phone number.
 * @param {string} code - The OTP code.
 * @param {Object} req - Express request object for capturing metadata.
 * @returns {Promise<Object>} Access token, refresh token, and user data.
 */
export const verifyLoginOTP = async (phone, code, req) => {
  const isValid = await smsService.verifyOTP(phone, code);
  if (!isValid) {
    throw new AppError('Invalid or expired OTP', 400);
  }

  const user = await User.findOne({ phone }).select('+password');
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Capture request metadata
  user.userAgent = req.headers['user-agent'];
  user.ipAddress = req.ip;

  // Generate tokens
  const { accessToken, refreshToken } = tokenService.generateTokens(user);

  // Log successful OTP login
  await ActivityLog.create({
    user: user._id,
    action: 'OTP_LOGIN_SUCCESS',
    metadata: {
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    },
  });

  logger.info(`User logged in via OTP: ${user.id}`);

  return { accessToken, refreshToken, user };
};

/**
 * Enables Two-Factor Authentication for a user.
 *
 * @param {string} userId - The user's ID.
 * @returns {Promise<void>}
 */
export const enableTwoFactorAuthentication = async (userId) => {
  await User.findByIdAndUpdate(userId, { isTwoFactorEnabled: true });

  // Log activity
  await ActivityLog.create({
    user: userId,
    action: 'TWO_FACTOR_SETUP',
  });

  logger.info(`Two-Factor Authentication enabled for user: ${userId}`);
};

/**
 * Disables Two-Factor Authentication for a user.
 *
 * @param {string} userId - The user's ID.
 * @returns {Promise<void>}
 */
export const disableTwoFactorAuthentication = async (userId) => {
  await User.findByIdAndUpdate(userId, {
    isTwoFactorEnabled: false,
    twoFactorSecret: undefined,
  });

  // Log activity
  await ActivityLog.create({
    user: userId,
    action: 'TWO_FACTOR_DISABLE',
  });

  logger.info(`Two-Factor Authentication disabled for user: ${userId}`);
};

/**
 * Generates and returns 2FA secret and QR code for a user.
 *
 * @param {string} userId - The user's ID.
 * @returns {Promise<Object>} 2FA secret and QR code.
 */
export const generate2FASecret = async (userId) => {
  const { generateSecret, generateQRCode } = smsService;

  const secret = generateSecret({ name: 'TestimonyApp' });
  const qrCode = generateQRCode(secret.otpauth_url);

  // Save secret temporarily; enable upon verification
  await User.findByIdAndUpdate(userId, { twoFactorSecret: secret.base32 });

  // Log activity
  await ActivityLog.create({
    user: userId,
    action: 'TWO_FACTOR_SETUP',
  });

  logger.info(`2FA secret and QR code generated for user: ${userId}`);

  return { secret: secret.base32, qrCode };
};

/**
 * Verifies the 2FA token provided by the user.
 *
 * @param {string} userId - The user's ID.
 * @param {string} token - The 2FA token.
 * @returns {Promise<boolean>} True if verification is successful.
 */
export const verify2FAToken = async (userId, token) => {
  const user = await User.findById(userId);
  if (!user || !user.twoFactorSecret) return false;

  const isValid = smsService.verifyToken(user.twoFactorSecret, token);
  if (isValid) {
    // Log successful 2FA verification
    await ActivityLog.create({
      user: user._id,
      action: 'TWO_FACTOR_VERIFIED',
    });
  }

  return isValid;
};

/**
 * Sets access and refresh tokens as HTTP-only cookies in the response.
 *
 * @param {Object} res - Express response object.
 * @param {string} accessToken - Access token.
 * @param {string} refreshToken - Refresh token.
 * @param {boolean} rememberMe - Whether to extend cookie expiration.
 */
export const setTokenCookies = (res, accessToken, refreshToken, rememberMe) => {
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: rememberMe
      ? parseInt(process.env.JWT_REMEMBER_ME_EXPIRES_IN, 10) * 1000
      : parseInt(process.env.JWT_COOKIE_EXPIRES_IN, 10) * 1000,
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: parseInt(process.env.JWT_REFRESH_COOKIE_EXPIRES_IN, 10) * 1000,
  });

  logger.info('Token cookies set.');
};

/**
 * Clears authentication cookies from the response.
 *
 * @param {Object} res - Express response object.
 */
export const clearTokenCookies = (res) => {
  res.cookie('access_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0),
  });

  res.cookie('refresh_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0),
  });

  logger.info('Token cookies cleared.');
};

const authService = {
  registerUser,
  loginUser,
  logoutUser,
  refreshTokens,
  getCurrentUser,
  verifyEmail,
  resendVerificationEmail,
  initiatePasswordReset,
  completePasswordReset,
  loginWithOTP,
  verifyLoginOTP,
  enableTwoFactorAuthentication,
  disableTwoFactorAuthentication,
  generate2FASecret,
  verify2FAToken,
  setTokenCookies,
  clearTokenCookies,
};

export default authService;
