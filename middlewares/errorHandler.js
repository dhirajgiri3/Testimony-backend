// src/middlewares/errorHandler.js

import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

/**
 * Global error handling middleware
 */
export const errorHandler = (err, req, res, next) => {
  // Log the error with request details and correlation ID
  logger.error(`Error [${req.id}]: ${err.name}: ${err.message}`, {
    stack: err.stack,
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.user?.id,
    body: req.body,
    query: req.query,
    params: req.params,
  });

  // Determine error type and status code
  const statusCode = err.statusCode || 500;
  const message = err.message || 'An unexpected error occurred';

  // Structure the error response
  const errorResponse = {
    success: false,
    error: {
      type: err.name || 'APIError',
      code: `ERR_${statusCode}`,
      message,
      ...(process.env.NODE_ENV === 'development' && {
        stack: err.stack,
        details: err.details || undefined,
      }),
    },
    requestId: req.id,
    timestamp: new Date().toISOString(),
  };

  // Handle specific error types
  if (err.name === 'ValidationError') {
    errorResponse.error.validationErrors = Object.values(err.errors || {}).map(
      (e) => ({
        field: e.path,
        message: e.message,
      })
    );
  }

  // Handle MongoDB duplicate key errors
  if (err.code === 11000) {
    errorResponse.error.type = 'DuplicateKeyError';
    errorResponse.error.message = 'Duplicate field value entered';
  }

  res.status(statusCode).json(errorResponse);
};

export const handleNotFound = (req, res, next) => {
  next(new AppError(`Not found - ${req.originalUrl}`, 404));
};

// Global promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Global exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Give the server time to send any pending responses before shutting down
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});