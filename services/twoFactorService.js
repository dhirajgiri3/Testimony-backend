import { authenticator } from "otplib";
import User from "../models/User.js";
import AppError from "../utils/appError.js";
import { logger } from "../utils/logger.js";
import ActivityLog from "../models/ActivityLog.js";
import { sendOTP, verifyOTP } from "./smsService.js";

// Constants
const TOTP_WINDOW = 1; // Allow 30 seconds before/after current time
const APP_NAME = "Testimony";
const SMS_OTP_EXPIRY = 10; // minutes

const TwoFactorMethod = {
  SMS: "sms",
  AUTHENTICATOR: "authenticator",
};

const twoFactorService = {
  generateSecret: () => authenticator.generateSecret(),

  generateTOTP: (secret) => {
    if (!secret) throw new AppError("Secret key is required", 400);
    return authenticator.generate(secret);
  },

  verifyTOTP: (token, secret) => {
    if (!token || !secret)
      throw new AppError("Token and secret are required", 400);
    return authenticator.check(token, secret, { window: TOTP_WINDOW });
  },

  generateQRCodeURI: (email, secret) => {
    if (!email || !secret)
      throw new AppError("Email and secret are required", 400);
    return authenticator.keyuri(email, APP_NAME, secret);
  },

  // New method for SMS OTP handling
  async sendSMSOTP(phone) {
    try {
      const response = await sendOTP(phone);
      return {
        success: true,
        expiresIn: SMS_OTP_EXPIRY,
        ...response,
      };
    } catch (error) {
      logger.error(`Failed to send SMS OTP: ${error.message}`);
      throw new AppError("Failed to send SMS verification code", 500);
    }
  },
};

const setupTwoFactorAuth = async (userId, method) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404);

  if (!Object.values(TwoFactorMethod).includes(method)) {
    throw new AppError("Invalid 2FA method", 400);
  }

  let setupData = {};

  if (method === TwoFactorMethod.SMS) {
    if (!user.phone) {
      throw new AppError("Phone number required for SMS 2FA", 400);
    }
    if (!user.isPhoneVerified) {
      throw new AppError("Phone number must be verified first", 400);
    }

    // Send SMS OTP
    try {
      setupData = await twoFactorService.sendSMSOTP(user.phone);
    } catch (error) {
      throw new AppError(`SMS 2FA setup failed: ${error.message}`, 500);
    }
  } else {
    // Authenticator app setup
    const secret = twoFactorService.generateSecret();
    user.twoFactorSecret = secret;
    setupData = {
      secret,
      qrCode: twoFactorService.generateQRCodeURI(user.email, secret),
    };
  }

  user.twoFactorMethod = method;
  user.twoFactorPending = true;
  await user.save();

  await ActivityLog.create({
    user: userId,
    action: "TWO_FACTOR_SETUP_INITIATED",
    details: { method, timestamp: new Date() },
  });

  logger.info(
    `2FA setup initiated for user: ${userId} using method: ${method}`
  );

  return {
    success: true,
    message: "2FA setup initiated",
    method,
    ...setupData,
  };
};

const enableTwoFactorAuth = async (userId, code) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404);
  if (!user.twoFactorPending)
    throw new AppError("2FA setup not initiated", 400);

  let isVerified = false;
  try {
    if (user.twoFactorMethod === TwoFactorMethod.AUTHENTICATOR) {
      isVerified = twoFactorService.verifyTOTP(code, user.twoFactorSecret);
    } else if (user.twoFactorMethod === TwoFactorMethod.SMS) {
      isVerified = await verifyOTP(user.phone, code);
    }

    if (!isVerified) {
      throw new AppError("Invalid verification code", 400);
    }

    user.isTwoFactorEnabled = true;
    user.twoFactorPending = false;
    user.twoFactorEnabledAt = new Date();
    await user.save();

    await ActivityLog.create({
      user: userId,
      action: "TWO_FACTOR_ENABLED",
      details: {
        method: user.twoFactorMethod,
        timestamp: new Date(),
      },
    });

    logger.info(`2FA enabled successfully for user: ${userId}`);
    return { success: true, message: "2FA enabled successfully" };
  } catch (error) {
    logger.error(
      `2FA verification failed for user ${userId}: ${error.message}`
    );
    throw new AppError(error.message || "Verification failed", 400);
  }
};

const disableTwoFactorAuth = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404);
  if (!user.isTwoFactorEnabled) throw new AppError("2FA is not enabled", 400);

  const previousMethod = user.twoFactorMethod;

  user.isTwoFactorEnabled = false;
  user.twoFactorMethod = undefined;
  user.twoFactorSecret = undefined;
  user.twoFactorPending = false;
  await user.save();

  await ActivityLog.create({
    user: userId,
    action: "TWO_FACTOR_DISABLED",
    details: {
      previousMethod,
      timestamp: new Date(),
    },
  });

  logger.info(`2FA disabled for user: ${userId}`);
  return { success: true, message: "2FA disabled successfully" };
};

export {
  twoFactorService,
  setupTwoFactorAuth,
  enableTwoFactorAuth,
  disableTwoFactorAuth,
};

export default twoFactorService;
