import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../config/redis.js';
import { createRateLimitError } from '../utils/errors.js';

// Redis store configuration for rate limiting
const redisStore = new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'ratelimit:'
});

// Common options for all rate limiters
const defaultOptions = {
    store: redisStore,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        throw createRateLimitError('Rate limit exceeded');
    }
};

/**
 * Authentication Rate Limiters
 */
export const loginRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per IP
    message: 'Too many login attempts, please try again after 15 minutes',
    keyGenerator: (req) => `login:${req.ip}:${req.body.email}`
});

export const registrationRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 registrations per IP
    message: 'Too many accounts created, please try again after an hour'
});

export const emailVerificationRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 30 * 60 * 1000, // 30 minutes
    max: 5, // 5 attempts per email
    message: 'Too many verification attempts, please try again later'
});

export const passwordResetRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 reset attempts per IP
    message: 'Too many password reset attempts, please try again after an hour'
});

/**
 * API Rate Limiters
 */
export const generalApiRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per IP
    message: 'Too many requests, please try again after 15 minutes'
});

export const testimonialSubmissionRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 10, // 10 testimonials per user per day
    keyGenerator: (req) => `testimonial:${req.user?.id || req.ip}`
});

export const aiProcessingRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // 50 AI requests per user per hour
    keyGenerator: (req) => `ai:${req.user?.id || req.ip}`
});

/**
 * User Action Rate Limiters
 */
export const profileUpdateRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 profile updates per user
    keyGenerator: (req) => `profile:${req.user?.id}`
});

export const searchRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 searches per minute per IP
    message: 'Too many search requests, please slow down'
});

/**
 * File Upload Rate Limiters
 */
export const fileUploadRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 file uploads per hour
    keyGenerator: (req) => `upload:${req.user?.id || req.ip}`
});

/**
 * Contact and Support Rate Limiters
 */
export const contactFormRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 3, // 3 contact form submissions per day per IP
    message: 'Too many contact form submissions, please try again tomorrow'
});

export const supportTicketRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 5, // 5 support tickets per day per user
    keyGenerator: (req) => `support:${req.user?.id}`
});

/**
 * Social Features Rate Limiters
 */
export const commentRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30, // 30 comments per hour
    keyGenerator: (req) => `comment:${req.user?.id}`
});

export const likeRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // 50 likes per hour
    keyGenerator: (req) => `like:${req.user?.id}`
});

/**
 * Token and Session Rate Limiters
 */
export const tokenRefreshRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30, // 30 token refreshes per hour
    keyGenerator: (req) => `refresh:${req.ip}:${req.user?.id}`
});

export const otpRequestRateLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 OTP requests per hour
    message: 'Too many OTP requests, please try again later'
});

// Export all rate limiters
export default {
    loginRateLimiter,
    registrationRateLimiter,
    emailVerificationRateLimiter,
    passwordResetRateLimiter,
    generalApiRateLimiter,
    testimonialSubmissionRateLimiter,
    aiProcessingRateLimiter,
    profileUpdateRateLimiter,
    searchRateLimiter,
    fileUploadRateLimiter,
    contactFormRateLimiter,
    supportTicketRateLimiter,
    commentRateLimiter,
    likeRateLimiter,
    tokenRefreshRateLimiter,
    otpRequestRateLimiter
};


