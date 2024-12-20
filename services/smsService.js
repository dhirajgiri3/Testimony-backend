// src/services/smsService.js

import twilio from 'twilio';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
import { normalizePhoneNumber } from '../utils/inputValidation.js';
import AppError from '../utils/appError.js';

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
const otpExpiration = parseInt(process.env.OTP_EXPIRATION_MINUTES, 10) || 10;

let client;

// Initialize Twilio client
try {
  if (!accountSid || !authToken || !verifyServiceSid) {
    logger.warn(
      'Twilio credentials not fully configured. SMS features will be disabled.'
    );
  } else {
    client = twilio(accountSid, authToken);
    logger.info(
      `✅ Twilio client initialized successfully. Ready to send SMS via Twilio Verify Service (Service SID: ${verifyServiceSid})`
    );
  }
} catch (error) {
  logger.error('❌ Twilio initialization error:', error.message);
}

/**
 * In-memory store for OTP attempts to prevent brute force attacks.
 * In production, consider using a persistent store like Redis.
 */
const otpAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

/**
 * Check if the phone number is locked out due to too many failed attempts.
 *
 * @param {string} phone - The phone number to check.
 * @returns {boolean} - True if locked out, else false.
 */
const isPhoneLocked = (phone) => {
  const attempts = otpAttempts.get(phone) || {
    count: 0,
    lastAttempt: Date.now(),
  };
  const isLocked =
    attempts.count >= MAX_ATTEMPTS &&
    Date.now() - attempts.lastAttempt < LOCKOUT_DURATION;
  return isLocked;
};

/**
 * Increment OTP attempt count for a phone number.
 *
 * @param {string} phone - The phone number.
 */
const incrementOTPAttempt = (phone) => {
  const attempts = otpAttempts.get(phone) || {
    count: 0,
    lastAttempt: Date.now(),
  };
  attempts.count += 1;
  attempts.lastAttempt = Date.now();
  otpAttempts.set(phone, attempts);
};

/**
 * Reset OTP attempt count for a phone number.
 *
 * @param {string} phone - The phone number.
 */
const resetOTPAttempt = (phone) => {
  otpAttempts.delete(phone);
};

/**
 * Send an OTP to the specified phone number using Twilio Verify Service.
 *
 * @param {string} phone - The phone number to send OTP to.
 * @returns {Promise<Object>} - Twilio verification object.
 * @throws {AppError} - If sending OTP fails.
 */
export const sendOTP = async (phone) => {
  if (!client) {
    throw new AppError('SMS service is not configured.', 500);
  }

  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) {
    throw new AppError('Invalid phone number format.', 400);
  }

  if (isPhoneLocked(normalizedPhone)) {
    throw new AppError('Too many OTP requests. Please try again later.', 429);
  }

  try {
    const verification = await client.verify
      .services(verifyServiceSid)
      .verifications.create({ to: normalizedPhone, channel: 'sms' });

    logger.info(
      `📲 OTP sent successfully to ${normalizedPhone}. SID: ${verification.sid}`
    );

    return {
      success: true,
      sid: verification.sid,
      expiresIn: otpExpiration,
    };
  } catch (error) {
    logger.error(`❌ Error sending OTP to ${phone}:`, error.message);
    throw new AppError('Failed to send OTP.', 500);
  }
};

/**
 * Verify the provided OTP for the specified phone number.
 *
 * @param {string} phone - The phone number.
 * @param {string} code - The OTP code to verify.
 * @returns {Promise<boolean>} - True if OTP is valid, else false.
 * @throws {AppError} - If verification fails.
 */
export const verifyOTP = async (phone, code) => {
  if (!client) {
    throw new AppError('SMS service is not configured.', 500);
  }

  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) {
    throw new AppError('Invalid phone number format.', 400);
  }

  if (isPhoneLocked(normalizedPhone)) {
    throw new AppError(
      'Too many failed OTP attempts. Please try again later.',
      429
    );
  }

  try {
    const verificationCheck = await client.verify
      .services(verifyServiceSid)
      .verificationChecks.create({ to: normalizedPhone, code });

    if (verificationCheck.status === 'approved') {
      resetOTPAttempt(normalizedPhone);
      logger.info(`✅ OTP verified successfully for phone: ${normalizedPhone}`);
      return true;
    } else {
      incrementOTPAttempt(normalizedPhone);
      logger.warn(
        `❌ OTP verification failed for phone: ${normalizedPhone}. Status: ${verificationCheck.status}`
      );
      return false;
    }
  } catch (error) {
    logger.error(
      `❌ OTP verification error for phone ${phone}:`,
      error.message
    );
    throw new AppError('Failed to verify OTP.', 500);
  }
};

/**
 * Resend OTP to the specified phone number.
 *
 * @param {string} phone - The phone number.
 * @returns {Promise<Object>} - Twilio verification object.
 * @throws {AppError} - If resending OTP fails.
 */
export const resendOTP = async (phone) => {
  try {
    logger.info(`🔄 Resending OTP to phone: ${phone}`);
    return await sendOTP(phone);
  } catch (error) {
    logger.error(`❌ Error resending OTP to ${phone}:`, error.message);
    throw new AppError('Failed to resend OTP.', 500);
  }
};

export default {
  sendOTP,
  verifyOTP,
  resendOTP,
};
