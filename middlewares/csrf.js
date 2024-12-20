// src/middlewares/csrf.js

import csrf from 'csurf';
import { logger } from '../utils/logger.js';

/**
 * Configure CSRF protection middleware with secure defaults
 */
const csrfProtection = csrf({
  cookie: {
    // Use secure cookies in production
    secure: process.env.NODE_ENV === 'production',
    // Restrict cookie to HTTP(S) only
    httpOnly: true,
    // Strict same-site policy
    sameSite: 'strict',
    // Set cookie path
    path: '/',
  },
  // Use double submit cookie pattern
  ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
  // Customize error handling
  value: (req) => {
    return req.headers['x-csrf-token'] || req.body._csrf || req.query._csrf;
  },
});

/**
 * Middleware to generate and attach CSRF token to responses
 */
const attachCsrfToken = (req, res, next) => {
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : null;
  next();
};

/**
 * Wrapper to handle CSRF errors gracefully
 */
const handleCsrfError = (err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') {
    return next(err);
  }

  logger.warn(`CSRF validation failed for request ID: ${req.id}`);

  res.status(403).json({
    status: 'fail',
    message: 'Invalid CSRF token',
  });
};

export { csrfProtection, attachCsrfToken, handleCsrfError };
