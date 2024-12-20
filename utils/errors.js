// utils/errors.js

import AppError from './appError.js';

/**
 * Create a new AppError with a message and status code
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @returns {AppError}
 */
const createError = (message, statusCode) => {
  return new AppError(message, statusCode);
};

/**
 * Create a validation error from express-validator
 * @param {Array} errors - Array of validation errors
 * @returns {AppError}
 */
const createValidationError = (errors) => {
  const message = errors.map((err) => err.msg).join(', ');
  return new AppError(message, 400);
};

const formatError = (err, includeStack = false) => {
  const error = {
    status: err.status,
    message: err.message,
  };

  if (includeStack) {
    error.stack = err.stack;
  }

  return error;
}

export { createError, createValidationError, formatError };
