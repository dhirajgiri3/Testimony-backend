// // src/middlewares/rateLimiter.js

// import { RateLimiterRedis } from 'rate-limiter-flexible';
// import redisClient from '../config/redis.js';
// import { logger } from '../utils/logger.js';
// import AppError from '../utils/appError.js';

// // Helper function to create rate limiter instances
// const createRateLimiter = (keyPrefix, points, duration, blockDuration) => {
//   return new RateLimiterRedis({
//     storeClient: redisClient,
//     keyPrefix,
//     points: parseInt(points, 10) || 100,
//     duration: parseInt(duration, 10) || 3600,
//     blockDuration: parseInt(blockDuration, 10) || 7200,
//   });
// };



// // Rate limiter instances
// const emailVerificationLimiter = createRateLimiter(
//   'email_verification_limit',
//   process.env.EMAIL_VERIFICATION_RATE_LIMIT_MAX,
//   process.env.EMAIL_VERIFICATION_RATE_LIMIT_DURATION,
//   process.env.EMAIL_VERIFICATION_BLOCK_DURATION
// );

// const emailResendLimiter = createRateLimiter(
//   'email_resend_limit',
//   process.env.EMAIL_RESEND_RATE_LIMIT_MAX,
//   process.env.EMAIL_RESEND_RATE_LIMIT_DURATION,
//   process.env.EMAIL_RESEND_BLOCK_DURATION
// );

// const profileUpdateLimiter = createRateLimiter(
//   'profile_update_limit',
//   process.env.PROFILE_UPDATE_RATE_LIMIT_MAX,
//   process.env.PROFILE_UPDATE_RATE_LIMIT_DURATION,
//   process.env.PROFILE_UPDATE_BLOCK_DURATION
// );

// const tokenRefreshLimiter = createRateLimiter(
//   'token_refresh_limit',
//   process.env.TOKEN_REFRESH_RATE_LIMIT_MAX,
//   process.env.TOKEN_REFRESH_RATE_LIMIT_DURATION,
//   process.env.TOKEN_REFRESH_BLOCK_DURATION
// );

// const loginAttemptLimiter = createRateLimiter(
//   'login_attempt_limit',
//   process.env.LOGIN_ATTEMPT_RATE_LIMIT_MAX,
//   process.env.LOGIN_ATTEMPT_RATE_LIMIT_DURATION,
//   process.env.LOGIN_ATTEMPT_BLOCK_DURATION
// );

// const otpRequestLimiter = createRateLimiter(
//   'otp_request_limit',
//   process.env.OTP_REQUEST_RATE_LIMIT_MAX,
//   process.env.OTP_REQUEST_RATE_LIMIT_DURATION,
//   process.env.OTP_REQUEST_BLOCK_DURATION
// );

// const passwordResetLimiter = createRateLimiter(
//   'password_reset_limit',
//   process.env.PASSWORD_RESET_RATE_LIMIT_MAX,
//   process.env.PASSWORD_RESET_RATE_LIMIT_DURATION,
//   process.env.PASSWORD_RESET_BLOCK_DURATION
// );

// // Middleware factory for rate limiting
// const createRateLimiterMiddleware = (limiter, errorMessage) => {
//   return async (req, res, next) => {
//     const key = req.headers['x-forwarded-for'] || req.ip;

//     try {
//       if (req.headers['x-forwarded-for']?.includes(',')) {
//         logger.warn(`Multiple IPs detected: ${req.headers['x-forwarded-for']}`);
//       }

//       await limiter.consume(key);

//       res.set('X-RateLimit-Limit', limiter.points);
//       res.set('X-RateLimit-Remaining', Math.max(limiter.points - (await limiter.get(key)).consumedPoints, 0));
//       res.set('X-RateLimit-Reset', new Date(Date.now() + limiter.duration * 1000).toUTCString());

//       next();
//     } catch (error) {
//       if (error instanceof Error) {
//         logger.error(`Rate limiter error for IP ${key}:`, error);
//         return next(new AppError('Internal server error', 500));
//       }

//       logger.warn(`Rate limit exceeded for IP: ${key}`);
//       const retryAfter = Math.ceil(error.msBeforeNext / 1000) || limiter.blockDuration;

//       res.set('Retry-After', retryAfter);
//       res.status(429).json({
//         success: false,
//         message: errorMessage || 'Too many requests, please try again later.',
//         retryAfter,
//       });
//     }
//   };
// };

// // Export enhanced middleware instances
// export const emailVerificationRateLimit = createRateLimiterMiddleware(
//   emailVerificationLimiter,
//   'Too many email verification attempts. Please try again later.'
// );

// export const emailResendRateLimit = createRateLimiterMiddleware(
//   emailResendLimiter,
//   'Too many email resend attempts. Please try again later.'
// );

// export const profileUpdateRateLimit = createRateLimiterMiddleware(
//   profileUpdateLimiter,
//   'Too many profile update attempts. Please try again later.'
// );

// export const tokenRefreshRateLimit = createRateLimiterMiddleware(
//   tokenRefreshLimiter,
//   'Too many token refresh attempts. Please try again later.'
// );

// export const loginAttemptRateLimit = createRateLimiterMiddleware(
//   loginAttemptLimiter,
//   'Too many login attempts. Please try again later.'
// );

// export const otpRequestRateLimit = createRateLimiterMiddleware(
//   otpRequestLimiter,
//   'Too many OTP requests. Please try again later.'
// );

// export const passwordResetRateLimit = createRateLimiterMiddleware(
//   passwordResetLimiter,
//   'Too many password reset attempts. Please try again later.'
// );

// export const rateLimitTestimonials = createRateLimiterMiddleware(
//   createRateLimiter('testimonials_limit', 10, 60, 7200),
//   'Too many testimonial requests. Please try again later.'
// );

import rateLimit from 'express-rate-limit';

// General Rate Limiting
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Specific Route Rate Limiting
export const specificRouteRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
