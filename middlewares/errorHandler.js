// src/middlewares/errorHandler.js

import { formatError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

/**
 * Error handling middleware
 */
export const errorHandler = (err, req, res, next) => {
  // If the error is not an instance of AppError, convert it
  if (!(err instanceof AppError)) {
    logger.error('Unexpected Error:', err);
    err = new AppError('An unexpected error occurred', 500);
  }

  // Log the error details
  logger.error(`Error [${err.statusCode}]: ${err.message}`, {
    stack: err.stack,
    user: req.user ? req.user.id : 'Unauthenticated',
    path: req.originalUrl,
  });

  // Format the error response
  const errorResponse = formatError(
    err,
    process.env.NODE_ENV === 'development'
  );

  res.status(err.statusCode).json(errorResponse);
};

/**
 * Handle CSRF Errors
 */
export const handleCsrfError = (err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') return next(err);

  // CSRF token errors
  res.status(403).json({
    status: 'fail',
    message: 'Invalid CSRF token',
  });
};

export const handleNotFound = (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
};
