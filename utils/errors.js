// src/utils/errors.js

import AppError from "./appError.js";

/**
 * Create a standardized AppError
 * @param {string} type - Error type/category
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @returns {AppError} - Custom AppError instance
 */
export const createError = (type, message, statusCode) => {
  return new AppError(message, statusCode, type);
};

/**
 * Format error response based on environment
 * @param {AppError} err - Error instance
 * @param {boolean} isDevelopment - Whether the environment is development
 * @returns {Object} - Formatted error response
 */
export const formatError = (err, isDevelopment) => {
  if (isDevelopment) {
    return {
      status: err.status,
      message: err.message,
      stack: err.stack,
      ...(err.errors && { errors: err.errors }),
    };
  } else {
    return {
      status: err.status,
      message: err.isOperational ? err.message : "An unexpected error occurred",
    };
  }
};

/**
 * Create Validation Error
 * @param {string} message - Validation error message
 * @returns {AppError} - Custom AppError instance
 */
export const createValidationError = (message) => {
  return new AppError(message, 400, "validation");
};

/**
 * Create Authentication Error
 * @param {string} message - Authentication error message
 * @returns {AppError} - Custom AppError instance
 */
export const createAuthenticationError = (message) => {
  return new AppError(message, 401, "authentication");
};

/**
 * Create Authorization Error
 * @param {string} message - Authorization error message
 * @returns {AppError} - Custom AppError instance
 */
export const createAuthorizationError = (message) => {
  return new AppError(message, 403, "authorization");
};

/**
 * Create Not Found Error
 * @param {string} message - Not Found error message
 * @returns {AppError} - Custom AppError instance
 */
export const createNotFoundError = (message) => {
  return new AppError(message, 404, "notFound");
};

export const OpenAIError = (message) => {
  return new AppError(message, 500, "openai");
};
