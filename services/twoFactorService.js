// src/services/twoFactorService.js

import { authenticator } from 'otplib';
import User from '../models/User.js';
import AppError from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import ActivityLog from '../models/ActivityLog.js';
import { sendOTP, verifyOTP } from './smsService.js';
import { rotateRefreshToken } from './tokenService.js';

/**
 * Constants
 */
const TOTP_WINDOW = 1; // Allow a window of 1 time step (30 seconds)
const APP_NAME = 'Testimony';
const SMS_OTP_EXPIRY = 10; // minutes
const MAX_VERIFICATION_ATTEMPTS = 5;

/**
 * Two-Factor Authentication Methods
 */
export const TwoFactorMethod = {
  SMS: 'sms',
  AUTHENTICATOR: 'authenticator',
};

/**
 * Generate a TOTP secret.
 *
 * @returns {string} - The generated secret.
 */
const generateSecret = () => {
  return authenticator.generateSecret();
};

/**
 * Generate a TOTP code for a given secret.
 *
 * @param {string} secret - The user's TOTP secret.
 * @returns {string} - The generated TOTP code.
 */
const generateTOTP = (secret) => {
  return authenticator.generate(secret);
};

/**
 * Verify a TOTP code.
 *
 * @param {string} token - The TOTP code to verify.
 * @param {string} secret - The user's TOTP secret.
 * @returns {boolean} - True if valid, else false.
 */
const verifyTOTP = (token, secret) => {
  return authenticator.check(token, secret, { window: TOTP_WINDOW });
};

/**
 * Generate a QR code URI for authenticator apps.
 *
 * @param {string} email - The user's email.
 * @param {string} secret - The user's TOTP secret.
 * @returns {string} - The QR code URI.
 */
const generateQRCodeURI = (email, secret) => {
  return authenticator.keyuri(email, APP_NAME, secret);
};

/**
 * Setup Two-Factor Authentication for a user.
 *
 * @param {string} userId - ID of the user.
 * @param {string} method - Method of 2FA ('sms' or 'authenticator').
 * @returns {Promise<Object>} - Setup details.
 * @throws {AppError} - If setup fails.
 */
export const setupTwoFactorAuth = async (userId, method) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found.', 404);

  if (!Object.values(TwoFactorMethod).includes(method)) {
    throw new AppError('Invalid 2FA method.', 400);
  }

  let setupData = {};

  if (method === TwoFactorMethod.SMS) {
    if (!user.phone) {
      throw new AppError('Phone number required for SMS 2FA.', 400);
    }
    if (!user.isPhoneVerified) {
      throw new AppError(
        'Phone number must be verified before enabling SMS 2FA.',
        400
      );
    }

    // Send SMS OTP for verification
    try {
      setupData = await sendOTP(user.phone);
    } catch (error) {
      logger.error(`SMS 2FA setup failed for user ${userId}: ${error.message}`);
      throw new AppError(`SMS 2FA setup failed: ${error.message}`, 500);
    }
  } else if (method === TwoFactorMethod.AUTHENTICATOR) {
    const secret = generateSecret();
    const qrCode = generateQRCodeURI(user.email, secret);
    setupData = { secret, qrCode };
  }

  // Update user with pending 2FA setup
  user.twoFactorMethod = method;
  user.twoFactorSecret =
    method === TwoFactorMethod.AUTHENTICATOR ? setupData.secret : null;
  user.twoFactorPending = true;
  user.twoFactorVerificationAttempts = 0;
  await user.save();

  // Log the setup initiation
  await ActivityLog.create({
    user: userId,
    action: 'TWO_FACTOR_SETUP_INITIATED',
    details: { method, timestamp: Date.now() },
  });

  logger.info(`2FA setup initiated for user ${userId} using method ${method}.`);

  return {
    success: true,
    message: '2FA setup initiated.',
    method,
    ...setupData,
  };
};

/**
 * Enable Two-Factor Authentication after verification.
 *
 * @param {string} userId - ID of the user.
 * @param {string} token - Verification token/code.
 * @returns {Promise<Object>} - Confirmation message.
 * @throws {AppError} - If enabling fails.
 */
export const enableTwoFactorAuth = async (userId, token) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found.', 404);
  if (!user.twoFactorPending)
    throw new AppError('2FA setup not initiated.', 400);

  if (user.twoFactorVerificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
    throw new AppError('Maximum verification attempts exceeded.', 429);
  }

  let isVerified = false;

  try {
    if (user.twoFactorMethod === TwoFactorMethod.AUTHENTICATOR) {
      isVerified = verifyTOTP(token, user.twoFactorSecret);
    } else if (user.twoFactorMethod === TwoFactorMethod.SMS) {
      isVerified = await verifyOTP(user.phone, token);
    }

    if (!isVerified) {
      user.twoFactorVerificationAttempts += 1;
      await user.save();
      throw new AppError('Invalid verification code.', 400);
    }

    // Enable 2FA
    user.isTwoFactorEnabled = true;
    user.twoFactorPending = false;
    user.twoFactorVerificationAttempts = 0;
    user.twoFactorEnabledAt = Date.now();
    await user.save();

    // Rotate tokens upon enabling 2FA
    await rotateRefreshToken(user, null, true);

    // Log the enabling action
    await ActivityLog.create({
      user: userId,
      action: 'TWO_FACTOR_ENABLED',
      details: { method: user.twoFactorMethod, timestamp: Date.now() },
    });

    logger.info(`2FA enabled successfully for user ${userId}.`);

    return { success: true, message: '2FA enabled successfully.' };
  } catch (error) {
    logger.error(`Failed to enable 2FA for user ${userId}: ${error.message}`);
    throw error;
  }
};

/**
 * Disable Two-Factor Authentication.
 *
 * @param {string} userId - ID of the user.
 * @returns {Promise<Object>} - Confirmation message.
 * @throws {AppError} - If disabling fails.
 */
export const disableTwoFactorAuth = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found.', 404);
  if (!user.isTwoFactorEnabled) throw new AppError('2FA is not enabled.', 400);

  user.isTwoFactorEnabled = false;
  user.twoFactorMethod = undefined;
  user.twoFactorSecret = undefined;
  user.twoFactorPending = false;
  user.twoFactorVerificationAttempts = 0;
  user.twoFactorEnabledAt = undefined;
  await user.save();

  // Rotate tokens upon disabling 2FA
  await rotateRefreshToken(user, null, true);

  // Log the disabling action
  await ActivityLog.create({
    user: userId,
    action: 'TWO_FACTOR_DISABLED',
    details: { timestamp: Date.now() },
  });

  logger.info(`2FA disabled for user ${userId}.`);

  return { success: true, message: '2FA disabled successfully.' };
};

export default {
  setupTwoFactorAuth,
  enableTwoFactorAuth,
  disableTwoFactorAuth,
};
