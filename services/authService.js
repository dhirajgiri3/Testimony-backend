import jwt from "jsonwebtoken";
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
import { body, validationResult } from "express-validator";

/**
 * Register a new user
 * @param {Object} userData - { firstName, lastName, email, password, phone }
 * @returns {Object} created user and verification token
 */
export const registerUser = async (userData) => {
    const { firstName, lastName, email, password, phone } = userData;

    // Use case-insensitive query with collation
    const userExists = await User.findOne({
        $or: [{ email: email }, { phone }],
    }).collation({ locale: "en", strength: 2 });

    if (userExists) {
        throw createError('validation', 'User already exists with this email or phone number', 400);
    }

    // Create user
    const user = await User.create({
        firstName,
        lastName,
        email: email.toLowerCase(), // Store email in lowercase
        password,
        phone,
        provider: "local",
    });

    if (!user) {
        throw createError('validation', 'Invalid user data', 400);
    }

    // Generate verification token
    const verificationToken = user.generateEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

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
 * Login user with email and password
 * @param {string} email
 * @param {string} password
 * @param {boolean} rememberMe
 * @param {Object} req - Express request object
 * @returns {Object} tokens and user
 */
export const loginUser = async (email, password, rememberMe, req) => {
    const user = await User.findOne({ email: email.toLowerCase() }).select(
        "+password"
    );

    if (!user) {
        throw createError('authentication', 'Invalid credentials', 401);
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > Date.now()) {
        const waitTime = Math.ceil((user.lockedUntil - Date.now()) / 1000 / 60);
        throw createError('authentication', `Account is locked. Please try again in ${waitTime} minutes`, 403);
    }

    // Check password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
        await updateLoginAttempts(user);

        // Log failed attempt
        await ActivityLog.create({
            user: user._id,
            action: "LOGIN_FAILED",
            details: { reason: "Invalid password" },
        });

        throw createError('authentication', 'Invalid credentials', 401);
    }

    // Check if verified
    if (!user.isEmailVerified) {
        throw createError('authentication', 'Please verify your email to login', 401);
    }

    // Reset login attempts and lock status
    user.loginAttempts = 0;
    user.lockedUntil = null;
    user.lastLogin = Date.now();
    await user.save();

    // Capture request metadata
    user.userAgent = req.headers["user-agent"];
    user.ipAddress = req.ip;

    const accessToken = createAccessToken(user);
    const refreshToken = createRefreshToken(user);

    // Log successful login
    await ActivityLog.create({
        user: user._id,
        action: "LOGIN_SUCCESS",
        details: { rememberMe },
    });

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
 * Logout user
 * @param {string} accessToken
 * @param {string} refreshToken
 * @param {string} userId
 */
export const logoutUser = async (accessToken, refreshToken, userId) => {
    try {
        if (accessToken) {
            await addToTokenBlacklist(accessToken, "access");
        }
        if (refreshToken) {
            await addToTokenBlacklist(refreshToken, "refresh");
        }

        if (userId) {
            await ActivityLog.create({
                user: userId,
                action: "LOGOUT",
            });
        }
    } catch (error) {
        logger.error("Logout service error:", error);
        throw createError('processing', 'Error during logout', 500);
    }
};

/**
 * Refresh tokens
 * @param {string} oldRefreshToken
 * @returns {Object} new tokens
 */
export const refreshTokens = async (oldRefreshToken) => {
    try {
        return await rotateRefreshToken(oldRefreshToken);
    } catch (error) {
        logger.error("Token refresh error:", error);
        throw createError('processing', 'Error refreshing tokens', 500);
    }
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
