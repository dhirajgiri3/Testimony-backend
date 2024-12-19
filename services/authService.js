import crypto from "crypto";
import User from "../models/User.js";
import ActivityLog from "../models/ActivityLog.js";
import { sendOTP, verifyOTP } from "./smsService.js";
import {
    createAccessToken,
    createRefreshToken,
    rotateRefreshToken,
} from "./tokenService.js";
import { createError } from "../utils/errors.js";
import { addToTokenBlacklist } from "./tokenBlacklistService.js";
import { logger } from "../utils/logger.js";

/**
 * Register a new user
 * @param {Object} userData - { firstName, lastName, email, password, username, phone }
 * @returns {Object} created user and verification token
 */
export const registerUser = async ({ firstName, lastName, email, password, username, phone }) => {
  const existingUser = await User.findOne({ email }).collation({ locale: 'en', strength: 2 });
  if (existingUser) {
    throw new AppError("Email already in use", 400);
  }

  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    username,
    phone,
  });

  const verificationToken = user.generateEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  logger.info(`New user registered: ${user.id}`);

  return { user, verificationToken };
};

/**
 * Resend verification email
 * @param {string} email
 * @returns {Object} verification token
 */
export const resendVerificationEmailService = async (email) => {
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
        throw createError('notFound', 'User not found', 404);
    }

    if (user.isEmailVerified) {
        throw createError('validation', 'Email is already verified', 400);
    }

    // Generate new verification token
    const verificationToken = user.generateEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    // Log activity
    await ActivityLog.create({
        user: user._id,
        action: "VERIFICATION_EMAIL_RESENT",
    });

    return { verificationToken };
};

/**
 * Login user and generate tokens
 * @param {Object} credentials - { email, password, rememberMe, req }
 * @returns {Object} accessToken, refreshToken, user
 */
export const loginUser = async ({ email, password, rememberMe, req }) => {
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.matchPassword(password))) {
    throw new AppError("Invalid email or password", 401);
  }

  if (!user.isEmailVerified) {
    throw new AppError("Please verify your email before logging in", 401);
  }

  const { accessToken, refreshToken } = tokenService.generateTokens(user);

  logger.info(`User logged in: ${user.id}`);

  return { accessToken, refreshToken, user };
};

/**
 * Update login attempts
 * @param {User} user
 */
const updateLoginAttempts = async (user) => {
    user.loginAttempts += 1;
    const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5;

    if (user.loginAttempts >= maxAttempts) {
        const lockDuration = parseInt(process.env.ACCOUNT_LOCK_TIME, 10) || 15; // in minutes
        user.lockedUntil = Date.now() + lockDuration * 60 * 1000;

        // Log account lock
        await ActivityLog.create({
            user: user._id,
            action: "ACCOUNT_LOCKED",
            details: { attempts: user.loginAttempts },
        });
    }
    await user.save();
};

/**
 * Logout user and blacklist tokens
 * @param {string} accessToken
 * @param {string} refreshToken
 */
export const logoutUser = async (accessToken, refreshToken) => {
  if (accessToken) {
    await addToTokenBlacklist(accessToken);
  }
  if (refreshToken) {
    await addToTokenBlacklist(refreshToken);
  }

  logger.info(`Tokens blacklisted for logout.`);
};

/**
 * Refresh tokens
 * @param {string} oldRefreshToken
 * @returns {Object} new accessToken and refreshToken
 */
export const refreshTokens = async (oldRefreshToken) => {
  if (!oldRefreshToken) {
    throw new AppError('No refresh token provided', 401);
  }

  const { accessToken, refreshToken } = await tokenService.rotateRefreshToken(oldRefreshToken);
  return { accessToken, refreshToken };
};

/**
 * Get current user
 * @param {string} userId
 * @returns {Object} user
 */
export const getCurrentUserService = async (userId) => {
    const user = await User.findById(userId);
    if (!user) {
        throw createError('notFound', 'User not found', 404);
    }
    return user;
};

/**
 * Verify Email
 * @param {string} token
 */
export const verifyEmailService = async (token) => {
    if (!token) {
        throw createError('validation', 'Verification token is required', 400);
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
        emailVerificationToken: hashedToken,
        emailVerificationTokenExpiry: { $gt: Date.now() },
    });

    if (!user) {
        throw createError('validation', 'Invalid or expired verification token', 400);
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationTokenExpiry = undefined;
    await user.save();

    // Log verification
    await ActivityLog.create({
        user: user._id,
        action: "EMAIL_VERIFIED",
    });

    return user;
};

/**
 * Login with OTP
 * @param {string} phone
 * @param {Object} req - Express request object
 * @returns {void}
 */
export const loginWithOTPService = async (phone, req) => {
    const user = await User.findOne({ phone });

    if (!user) {
        throw createError('notFound', 'User not found', 404);
    }

    await sendOTP(phone);

    // Log OTP request
    await ActivityLog.create({
        user: user._id,
        action: "OTP_REQUESTED",
    });
};

/**
 * Verify OTP for Login
 * @param {string} phone
 * @param {string} code
 * @param {Object} req - Express request object
 * @returns {Object} tokens and user
 */
export const verifyLoginOTPService = async (phone, code, req) => {
    const isValid = await verifyOTP(phone, code);
    if (!isValid) {
        throw createError('validation', 'Invalid or expired OTP', 400);
    }

    const user = await User.findOne({ phone });
    if (!user) {
        throw createError('notFound', 'User not found', 404);
    }

    // Capture request metadata
    user.userAgent = req.headers["user-agent"];
    user.ipAddress = req.ip;

    const accessToken = createAccessToken(user);
    const refreshToken = createRefreshToken(user);

    // Log successful OTP login
    await ActivityLog.create({
        user: user._id,
        action: "OTP_LOGIN_SUCCESS",
    });

    return { accessToken, refreshToken, user };
};

/**
 * Complete password reset
 * @param {string} token
 * @param {string} newPassword
 * @returns {Object} updated user
 */
export const resetPassword = async (token, newPassword) => {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const user = await User.findOne({
        passwordResetToken: tokenHash,
        passwordResetTokenExpiry: { $gt: Date.now() }
    });

    if (!user) {
        throw createError('validation', 'Invalid or expired password reset token', 400);
    }

    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpiry = undefined;
    await user.save();

    // Log the password reset
    await ActivityLog.create({
        user: user.id,
        action: "PASSWORD_RESET",
        details: {
            ip: user.lastLoginIP || 'Unknown',
            userAgent: user.lastLoginUserAgent || 'Unknown'
        }
    });

    logger.info(`Password reset successful for user: ${user.id}`);
    return user;
};

/**
 * Enable Two-Factor Authentication for a user
 * @param {string} userId
 */
export const enableTwoFactorAuthentication = async (userId) => {
  await User.findByIdAndUpdate(userId, { isTwoFactorEnabled: true });
};

/**
 * Generate and return 2FA secret and QR code
 * @param {string} userId
 * @returns {Object} { secret, qrCode }
 */
export const generate2FASecret = async (userId) => {
  const secret = twoFactor.generateSecret({ name: 'TestimonyApp' });
  const qrCode = twoFactor.generateQRCode(secret.otpauth_url);

  // Save secret temporarily; enable upon verification
  await User.findByIdAndUpdate(userId, { twoFactorSecret: secret.base32 });

  return { secret: secret.base32, qrCode };
};

/**
 * Verify 2FA token
 * @param {string} userId
 * @param {string} token
 * @returns {boolean}
 */
export const verify2FAToken = async (userId, token) => {
  const user = await User.findById(userId);
  if (!user || !user.twoFactorSecret) return false;

  return twoFactor.verifyToken(user.twoFactorSecret, token);
};

/**
 * Set token cookies
 * @param {Object} res - Express response object
 * @param {string} accessToken
 * @param {string} refreshToken
 * @param {boolean} rememberMe
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

export const initiatePasswordReset = async (email, req) => {
    const user = await User.findOne({ email: email.toLowerCase() }).select('+twoFactorSecret +isTwoFactorEnabled');

    if (!user) {
        throw createError('notFound', 'User not found', 404);
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    user.passwordResetToken = resetTokenHash;
    user.passwordResetTokenExpiry = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save();

    // Send reset email
    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

    await sendEmail({
        to: user.email,
        subject: 'Password Reset Request',
        template: 'passwordReset',
        context: {
            resetUrl
        }
    });

    // Log the password reset request
    await ActivityLog.create({
        user: user._id,
        action: "PASSWORD_RESET_REQUEST",
        details: {
            ip: req.ip || 'Unknown',
            userAgent: req.headers["user-agent"] || 'Unknown'
        }
    });

    logger.info(`Password reset initiated for user: ${user._id}`);
};

