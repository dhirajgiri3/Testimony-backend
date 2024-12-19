import asyncHandler from 'express-async-handler';
import {
  registerUser,
  verifyEmailService,
  resendVerificationEmailService,
  loginUser,
  logoutUser,
  loginWithOTPService,
  verifyLoginOTPService,
  refreshTokens,
  initiatePasswordReset,
  resetPassword,
} from '../services/authService.js';
import { addToTokenBlacklist } from '../services/tokenBlacklistService.js';
import { createVerificationEmailTemplate, createPasswordResetEmailTemplate } from '../utils/emailTemplates.js';
import { createError } from '../utils/errors.js';
import {
  emailVerificationRateLimiter,
  loginRateLimiter,
  tokenRefreshRateLimiter,
  otpRequestRateLimiter,
  emailRateLimiter,
  passwordResetRateLimiter,
} from '../middlewares/rateLimiter.js';
import { rotateRefreshToken } from '../services/tokenService.js';
import { body, validationResult } from 'express-validator';
import csrf from 'csurf';
import { queues } from '../jobs/queues.js';

// Initialize CSRF protection
const csrfProtection = csrf({ cookie: true });

/**
 * @desc    Register a new user
 * @route   POST /api/v1/auth/register
 * @access  Public
 */
export const register = [
  emailVerificationRateLimiter,
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createError('validation', 'Invalid input', { errors: errors.array() }));
    }

    const { firstName, lastName, email, password, phone } = req.body;

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
  asyncHandler(async (req, res, next) => {
    const token = req.params.token;

    if (!token) {
      return next(createError('validation', 'Verification token is required'));
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
  emailRateLimiter,
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createError('validation', 'Invalid input', { errors: errors.array() }));
    }

    const { email } = req.body;

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
  loginRateLimiter,
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
  csrfProtection,
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createError('validation', 'Invalid input', { errors: errors.array() }));
    }

    const { email, password, rememberMe = false } = req.body;

    const { accessToken, refreshToken, user } = await loginUser(
      email,
      password,
      rememberMe,
      req
    );

    // Set tokens in HttpOnly cookies with Secure and SameSite attributes
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
  tokenRefreshRateLimiter,
  csrfProtection,
  asyncHandler(async (req, res, next) => {
    const oldRefreshToken = req.cookies.refresh_token;

    if (!oldRefreshToken) {
      return next(createError('authentication', 'No refresh token provided', 401));
    }

    const { accessToken, refreshToken } = await rotateRefreshToken(oldRefreshToken, res);

    res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
    });
  }),
];

/**
 * @desc    Google OAuth callback
 * @route   GET /api/v1/auth/google/callback
 * @access  Public
 */
export const googleAuthCallback = [
  asyncHandler(async (req, res, next) => {
    if (!req.user) {
      return next(createError('authentication', 'Authentication failed', 401));
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
  csrfProtection,
  asyncHandler(async (req, res, next) => {
    if (!req.user?.id) {
      return next(createError('authentication', 'Not authenticated', 401));
    }

    const accessToken = req.cookies.access_token;
    const refreshToken = req.cookies.refresh_token;

    await logoutUser(accessToken, refreshToken, req.user.id);

    // Clear cookies securely
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: new Date(0),
    };

    res.cookie('access_token', '', cookieOptions);
    res.cookie('refresh_token', '', cookieOptions);

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
  otpRequestRateLimiter,
  body('phone').notEmpty().withMessage('Phone number is required').trim().escape(),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createError('validation', 'Invalid input', { errors: errors.array() }));
    }

    const { phone } = req.body;

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
  body('phone').notEmpty().withMessage('Phone number is required').trim().escape(),
  body('code').notEmpty().withMessage('OTP code is required').trim().escape(),
  csrfProtection,
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createError('validation', 'Invalid input', { errors: errors.array() }));
    }

    const { phone, code } = req.body;

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

/**
 * @desc    Handle password reset request
 * @route   POST /api/v1/auth/forgot-password
 * @access  Public
 */
export const forgotPassword = [
  passwordResetRateLimiter,
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createError('validation', 'Invalid input', { errors: errors.array() }));
    }

    const { email } = req.body;

    await initiatePasswordReset(email);

    res.status(200).json({
      success: true,
      message: 'Password reset instructions sent to your email.',
    });
  }),
];

/**
 * @desc    Handle password reset
 * @route   POST /api/v1/auth/reset-password
 * @access  Public
 */
export const resetPasswordController = [
  body('token').notEmpty().withMessage('Reset token is required').trim().escape(),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createError('validation', 'Invalid input', { errors: errors.array() }));
    }

    const { token, newPassword } = req.body;

    await resetPassword(token, newPassword);

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully.',
    });
  }),
];
