// src/services/smsService.js

import twilio from 'twilio';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
import { normalizePhoneNumber } from '../utils/inputValidation.js';

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
const otpExpiration = parseInt(process.env.OTP_EXPIRATION_MINUTES, 10) || 10;

let client;

// Initialize Twilio client
try {
  if (!accountSid || !authToken || !verifyServiceSid) {
    logger.warn('Twilio credentials not fully configured. SMS features will be disabled.');
  } else {
    client = twilio(accountSid, authToken);
    logger.info(`✅ Twilio client initialized successfully. Ready to send SMS via Twilio Verify Service (Service SID: ${verifyServiceSid})`);
  }
} catch (error) {
  logger.error('❌ Twilio initialization error:', error.message);
}

// Store OTP attempts to prevent brute force
const otpAttempts = new Map();
const MAX_ATTEMPTS = 3;
const LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

const isPhoneLocked = (phone) => {
  const attempts = otpAttempts.get(phone) || { count: 0 };
  return attempts.count >= MAX_ATTEMPTS && 
         (Date.now() - attempts.lastAttempt) < LOCKOUT_DURATION;
};

export const sendOTP = async (to) => {
  try {
    const normalizedPhone = normalizePhoneNumber(to);
    if (!normalizedPhone) throw new Error('Invalid phone number format.');

    if (isPhoneLocked(normalizedPhone)) {
      throw new Error('Too many attempts. Please try again later.');
    }

    const verification = await client.verify
      .services(verifyServiceSid)
      .verifications.create({ 
        to: normalizedPhone, 
        channel: 'sms',
        // Set OTP expiration time
        validityPeriod: otpExpiration * 60 // Convert minutes to seconds
      });

    logger.info(`📲 OTP sent successfully to ${normalizedPhone}. SID: ${verification.sid}`);
    return { success: true, sid: verification.sid, expiresIn: otpExpiration };
  } catch (error) {
    logger.error(`❌ Error sending OTP to ${to}:`, error.message);
    throw new Error('Failed to send OTP');
  }
};

export const verifyOTP = async (to, code) => {
  try {
    const normalizedPhone = normalizePhoneNumber(to);
    if (!normalizedPhone) throw new Error('Invalid phone number format.');

    if (isPhoneLocked(normalizedPhone)) {
      throw new Error('Too many attempts. Please try again later.');
    }

    const attempts = otpAttempts.get(normalizedPhone) || { count: 0, lastAttempt: Date.now() };

    const verificationCheck = await client.verify
      .services(verifyServiceSid)
      .verificationChecks.create({ to: normalizedPhone, code });

    if (verificationCheck.status === 'approved') {
      // Reset attempts on successful verification
      otpAttempts.delete(normalizedPhone);
      logger.info(`✅ OTP verified successfully for phone: ${normalizedPhone}`);
      return true;
    } else {
      // Increment failed attempts
      attempts.count += 1;
      attempts.lastAttempt = Date.now();
      otpAttempts.set(normalizedPhone, attempts);

      logger.warn(`❌ OTP verification failed for phone: ${normalizedPhone}. Attempts: ${attempts.count}`);
      return false;
    }
  } catch (error) {
    logger.error(`❌ OTP verification error for phone ${to}:`, error.message);
    return false;
  }
};

export const resendOTP = async (to) => {
  try {
    const normalizedPhone = normalizePhoneNumber(to);
    if (isPhoneLocked(normalizedPhone)) {
      throw new Error('Too many attempts. Please try again later.');
    }

    logger.info(`🔄 Resending OTP for phone: ${to}`);
    return await sendOTP(to);
  } catch (error) {
    logger.error(`❌ Error resending OTP to ${to}:`, error.message);
    throw new Error('Failed to resend OTP');
  }
};