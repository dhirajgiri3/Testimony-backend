// src/middlewares/rateLimiter.js

import { redis } from "../config/redis.js";
import { logger } from "../utils/logger.js";

/**
 * Custom Redis-based rate limiter middleware.
 * @param {Object} options - Configuration options for the rate limiter.
 * @param {number} options.windowMs - Time frame for which requests are checked/remembered in milliseconds.
 * @param {number} options.max - Maximum number of requests allowed within the windowMs.
 * @param {Function} options.keyGenerator - Function to generate a unique key for each request.
 * @param {string} options.message - Message to send when rate limit is exceeded.
 * @returns {Function} Express middleware function.
 */
const redisRateLimiter = ({ windowMs, max, keyGenerator, message }) => {
  return async (req, res, next) => {
    const key = keyGenerator(req);
    try {
      // Increment the count for the key
      const current = await redis.incr(key);

      if (current === 1) {
        // Set the expiration for the key
        await redis.pexpire(key, windowMs);
      }

      if (current > max) {
        // Rate limit exceeded
        logger.warn(`Rate limit exceeded for key: ${key}`);
        return res.status(429).json({
          success: false,
          message: message || "Too many requests, please try again later.",
        });
      }

      // Optionally, set rate limit info in headers
      res.set({
        "X-RateLimit-Limit": max,
        "X-RateLimit-Remaining": Math.max(max - current, 0),
        "X-RateLimit-Reset": Math.floor((Date.now() + windowMs) / 1000),
      });

      next();
    } catch (error) {
      // In case of Redis errors, log the error and allow the request to proceed
      logger.error("❌ Redis Rate Limiter Error:", error);
      next();
    }
  };
};

/**
 * Factory function to create specific rate limiters.
 * @param {Object} options - Configuration options for the rate limiter.
 * @returns {Function} Express middleware function.
 */
const createRateLimiter = (options) => redisRateLimiter(options);

/**
 * Authentication Rate Limiters
 */
export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per key
  keyGenerator: (req) => `login:${req.ip}:${req.body.email}`,
  message: "Too many login attempts, please try again after 15 minutes.",
});

export const registrationRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per key
  keyGenerator: (req) => `registration:${req.ip}`,
  message:
    "Too many accounts created from this IP, please try again after an hour.",
});

export const emailVerificationRateLimiter = createRateLimiter({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 5, // 5 attempts per email
  keyGenerator: (req) => `emailVerification:${req.body.email}`,
  message: "Too many verification attempts, please try again later.",
});

export const passwordResetRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 reset attempts per IP
  keyGenerator: (req) => `passwordReset:${req.ip}`,
  message: "Too many password reset attempts, please try again after an hour.",
});

/**
 * API Rate Limiters
 */
export const generalApiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per key
  keyGenerator: (req) => `api:${req.ip}`,
  message: "Too many requests from this IP, please try again after 15 minutes.",
});

export const testimonialSubmissionRateLimiter = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 10, // 10 testimonials per user per day
  keyGenerator: (req) => `testimonial:${req.user?.id || req.ip}`,
  message: "Too many testimonials submitted, please try again tomorrow.",
});

export const aiProcessingRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 AI requests per user per hour
  keyGenerator: (req) => `ai:${req.user?.id || req.ip}`,
  message: "Too many AI requests, please try again after an hour.",
});

/**
 * User Action Rate Limiters
 */
export const profileUpdateRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 profile updates per user
  keyGenerator: (req) => `profileUpdate:${req.user?.id}`,
  message: "Too many profile updates, please try again later.",
});

export const searchRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 searches per IP per minute
  keyGenerator: (req) => `search:${req.ip}`,
  message: "Too many search requests, please slow down.",
});

/**
 * File Upload Rate Limiters
 */
export const fileUploadRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 file uploads per user per hour
  keyGenerator: (req) => `fileUpload:${req.user?.id || req.ip}`,
  message: "Too many file uploads, please try again after an hour.",
});

/**
 * Contact and Support Rate Limiters
 */
export const contactFormRateLimiter = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 3, // 3 contact form submissions per IP per day
  keyGenerator: (req) => `contactForm:${req.ip}`,
  message: "Too many contact form submissions, please try again tomorrow.",
});

export const supportTicketRateLimiter = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 5, // 5 support tickets per user per day
  keyGenerator: (req) => `supportTicket:${req.user?.id}`,
  message: "Too many support tickets submitted, please try again tomorrow.",
});

/**
 * Social Features Rate Limiters
 */
export const commentRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 comments per user per hour
  keyGenerator: (req) => `comment:${req.user?.id}`,
  message: "Too many comments, please try again after an hour.",
});

export const likeRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 likes per user per hour
  keyGenerator: (req) => `like:${req.user?.id}`,
  message: "Too many likes, please try again after an hour.",
});

/**
 * Token and Session Rate Limiters
 */
export const tokenRefreshRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 token refreshes per user per hour
  keyGenerator: (req) => `tokenRefresh:${req.ip}:${req.user?.id}`,
  message: "Too many token refresh attempts, please try again later.",
});

export const otpRequestRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 OTP requests per IP per hour
  keyGenerator: (req) => `otpRequest:${req.ip}`,
  message: "Too many OTP requests, please try again later.",
});

/**
 * Email Resend Rate Limiter
 */
export const emailResendRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 email resend attempts per IP per hour
  keyGenerator: (req) => `emailResend:${req.ip}`,
  message: "Too many email resend attempts, please try again after an hour.",
});

/**
 * Testimonial Rate Limiter
 */
export const rateLimitTestimonials = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per IP per 15 minutes
  keyGenerator: (req) => `testimonial:${req.ip}`,
  message: "Too many testimonial submissions, please try again later.",
});

/**
 * Email Rate Limiter
 */
export const emailRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 email requests per IP per hour
  keyGenerator: (req) => `email:${req.ip}`,
  message: "Too many email requests, please try again after an hour.",
});

/**
 * Login Attempt Rate Limiter
 */
export const loginAttemptRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per IP per 15 minutes
  keyGenerator: (req) => `loginAttempt:${req.ip}`,
  message: "Too many login attempts, please try again later.",
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
  otpRequestRateLimiter,
  emailResendRateLimiter,
  rateLimitTestimonials,
  emailRateLimiter,
  loginAttemptRateLimiter,
};
