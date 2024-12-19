import asyncHandler from 'express-async-handler';
import queues from '../jobs/queues.js';
import {
  registerUser,
  verifyEmailService,
  resendVerificationEmailService,
  loginUser,
  logoutUser,
  loginWithOTPService,
  verifyLoginOTPService,
  refreshTokens,
} from '../services/authService.js';
import { addToTokenBlacklist } from '../services/tokenBlacklistService.js';
import { createVerificationEmailTemplate, createPasswordResetEmailTemplate } from '../utils/emailTemplates.js';
import AppError from '../utils/appError.js';
import {
  emailVerificationRateLimit,
  emailResendRateLimit,
  loginAttemptRateLimit,
  tokenRefreshRateLimit,
  otpRequestRateLimit,
  passwordResetRateLimit,
} from '../middlewares/rateLimiter.js';
import { rotateRefreshToken } from '../services/tokenService.js';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';

// Rate limiting for auth endpoints
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: "Too many requests from this IP, please try again later"
});

/**
 * @desc    Register a new user
 * @route   POST /api/v1/auth/register
 * @access  Public
 */
export const register = [
  authRateLimiter,
  emailVerificationRateLimit,
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { firstName, lastName, email, password, phone } = req.body;

    if (!firstName || !lastName || !email || !password) {
      throw new AppError('Please provide all required fields', 400);
    }

    const { user, verificationToken } = await registerUser({
      firstName,
      lastName,
      email,
      password,
      phone,
    });

    // Create verification link
    const verificationLink = `${process.env.CLIENT_URL}/verify-email/${verificationToken}`;

    // Enqueue email sending job
    await queues.emailQueue.add('sendVerificationEmail', {
      email,
      subject: 'Verify Your Email',
      html: createVerificationEmailTemplate(verificationLink),
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email.',
    });
  }),
];

/**
 * @desc    Verify email
 * @route   GET /api/v1/auth/verify-email/:token
 * @access  Public
 */
export const verifyEmail = [
  authRateLimiter,
  asyncHandler(async (req, res, next) => {
    const token = req.params.token;

    if (!token) {
      throw new AppError('Verification token is required', 400);
    }

    await verifyEmailService(token);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
    });
  }),
];

/**
 * @desc    Resend verification email
 * @route   POST /api/v1/auth/resend-verification
 * @access  Public
 */
export const resendVerificationEmail = [
  authRateLimiter,
  emailResendRateLimit,
  body('email').isEmail().withMessage('Valid email is required'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    const { verificationToken } = await resendVerificationEmailService(email);

    const verificationLink = `${process.env.CLIENT_URL}/verify-email/${verificationToken}`;

    // Enqueue email sending job
    await queues.emailQueue.add('sendVerificationEmail', {
      email,
      subject: 'Verify Your Email',
      html: createVerificationEmailTemplate(verificationLink),
    });

    res.status(200).json({
      success: true,
      message: 'Verification email resent successfully',
    });
  }),
];

/**
 * @desc    Login user
 * @route   POST /api/v1/auth/login
 * @access  Public
 */
export const login = [
  authRateLimiter,
  loginAttemptRateLimit,
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, rememberMe = false } = req.body;

    const { accessToken, refreshToken, user } = await loginUser(
      email,
      password,
      rememberMe,
      req
    );

    // Set tokens in HttpOnly cookies
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

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        phone: user.phone,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
      },
    });
  }),
];

/**
 * @desc    Refresh token
 * @route   POST /api/v1/auth/refresh-token
 * @access  Public
 */
export const refreshTokenController = [
  authRateLimiter,
  tokenRefreshRateLimit,
  asyncHandler(async (req, res, next) => {
    const oldRefreshToken = req.cookies.refresh_token;

    if (!oldRefreshToken) {
      throw new AppError('No refresh token provided', 401);
    }

    const { accessToken, refreshToken } = await rotateRefreshToken(oldRefreshToken, res);

    res.status(200).json({ success: true });
  }),
];

/**
 * @desc    Google OAuth callback
 * @route   GET /api/v1/auth/google/callback
 * @access  Public
 */
export const googleAuthCallback = [
  authRateLimiter,
  asyncHandler(async (req, res, next) => {
    if (!req.user) {
      throw new AppError('Authentication failed', 401);
    }

    const user = req.user;
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    };

    res.cookie('access_token', accessToken, {
      ...cookieOptions,
      maxAge: ms(process.env.JWT_ACCESS_EXPIRES_IN || '15m'),
    });

    res.cookie('refresh_token', refreshToken, {
      ...cookieOptions,
      maxAge: ms(process.env.JWT_REFRESH_EXPIRES_IN || '7d'),
    });

    res.redirect(`${process.env.CLIENT_URL}/auth/success`);
  })
];

/**
 * @desc    Logout user
 * @route   POST /api/v1/auth/logout
 * @access  Private
 */
export const logout = [
  authRateLimiter,
  asyncHandler(async (req, res, next) => {
    if (!req.user?.id) {
      throw new AppError('Not authenticated', 401);
    }

    const accessToken = req.cookies.access_token;
    const refreshToken = req.cookies.refresh_token;

    if (accessToken) {
      await addToTokenBlacklist(accessToken, "access");
    }

    if (refreshToken) {
      await addToTokenBlacklist(refreshToken, "refresh");
    }

    // Clear cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: new Date(0),
    };

    res.cookie('access_token', 'none', cookieOptions);
    res.cookie('refresh_token', 'none', cookieOptions);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  }),
];

/**
 * @desc    Send OTP for phone login
 * @route   POST /api/v1/auth/send-otp
 * @access  Public
 */
export const sendPhoneOTP = [
  authRateLimiter,
  otpRequestRateLimit,
  body('phone').notEmpty().withMessage('Phone number is required'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phone } = req.body;

    if (!phone) {
      throw new AppError('Phone number is required', 400);
    }

    await loginWithOTPService(phone, req); // Pass req to capture metadata

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
    });
  }),
];

/**
 * @desc    Verify OTP for Login
 * @route   POST /api/v1/auth/verify-otp
 * @access  Public
 */
export const verifyPhoneOTP = [
  authRateLimiter,
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('code').notEmpty().withMessage('OTP code is required'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phone, code } = req.body;

    if (!phone || !code) {
      throw new AppError('Phone and OTP code are required', 400);
    }

    const { accessToken, refreshToken, user } = await verifyLoginOTPService(
      phone,
      code,
      req
    );

    // Set cookies with enhanced security
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    };

    res.cookie('access_token', accessToken, {
      ...cookieOptions,
      maxAge: parseInt(process.env.JWT_ACCESS_EXPIRES_IN, 10) * 1000 || 15 * 60 * 1000, // 15 minutes
    });

    res.cookie('refresh_token', refreshToken, {
      ...cookieOptions,
      maxAge: parseInt(process.env.JWT_REFRESH_EXPIRES_IN, 10) * 1000 || 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        phone: user.phone,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
      },
    });
  }),
];
