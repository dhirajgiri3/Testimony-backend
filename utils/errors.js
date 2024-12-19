/**
 * Creates base error object with common properties
 */
const createBaseError = (message, statusCode = 500, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
  error.isOperational = true;
  error.extra = extra;
  Error.captureStackTrace(error, createBaseError);
  return error;
};

/**
 * Error creator functions for different types of errors
 */
export const createValidationError = (message, extra = {}) => {
  const error = createBaseError(message, 400, extra);
  error.name = "ValidationError";
  return error;
};

export const createAuthenticationError = (
  message = "Authentication failed",
  extra = {}
) => {
  const error = createBaseError(message, 401, extra);
  error.name = "AuthenticationError";
  return error;
};

export const createAuthorizationError = (
  message = "Not authorized to access this resource",
  extra = {}
) => {
  const error = createBaseError(message, 403, extra);
  error.name = "AuthorizationError";
  return error;
};

export const createNotFoundError = (
  message = "Resource not found",
  extra = {}
) => {
  const error = createBaseError(message, 404, extra);
  error.name = "NotFoundError";
  return error;
};

export const createRateLimitError = (
  message = "Too many requests",
  extra = {}
) => {
  const error = createBaseError(message, 429, extra);
  error.name = "RateLimitError";
  return error;
};

export const createDatabaseError = (
  message = "Database operation failed",
  extra = {}
) => {
  const error = createBaseError(message, 500, extra);
  error.name = "DatabaseError";
  error.isOperational = false;
  return error;
};

export const createOpenAIError = (message = "OpenAI API error", extra = {}) => {
  const error = createBaseError(message, 503, extra);
  error.name = "OpenAIError";
  return error;
};

export const createCacheError = (
  message = "Cache operation failed",
  extra = {}
) => {
  const error = createBaseError(message, 500, extra);
  error.name = "CacheError";
  return error;
};

export const createFileError = (
  message = "File operation failed",
  extra = {}
) => {
  const error = createBaseError(message, 500, extra);
  error.name = "FileError";
  return error;
};

export const createThirdPartyAPIError = (
  message = "Third party API error",
  extra = {}
) => {
  const error = createBaseError(message, 502, extra);
  error.name = "ThirdPartyAPIError";
  return error;
};

export const createTimeoutError = (
  message = "Operation timed out",
  extra = {}
) => {
  const error = createBaseError(message, 504, extra);
  error.name = "TimeoutError";
  return error;
};

/**
 * Factory function to create errors by type
 */
export const createError = (type, message, extra = {}) => {
  const errorCreators = {
    validation: createValidationError,
    auth: createAuthenticationError,
    authorization: createAuthorizationError,
    notFound: createNotFoundError,
    rateLimit: createRateLimitError,
    database: createDatabaseError,
    openai: createOpenAIError,
    cache: createCacheError,
    file: createFileError,
    thirdParty: createThirdPartyAPIError,
    timeout: createTimeoutError,
    default: createBaseError,
  };

  const createSpecificError = errorCreators[type] || errorCreators.default;
  return createSpecificError(message, extra);
};

/**
 * Async error handler
 */
export const asyncErrorHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Format error response
 */
export const formatError = (err, includeStack = false) => ({
  status: err.status || "error",
  statusCode: err.statusCode || 500,
  message: err.message,
  code: err.code,
  name: err.name,
  ...(includeStack && err.stack ? { stack: err.stack } : {}),
  ...(err.extra && Object.keys(err.extra).length > 0
    ? { details: err.extra }
    : {}),
});

export const OpenAIError = createOpenAIError("OpenAI API error", {
  code: "openai_error",
});

export default {
  createError,
  createValidationError,
  createAuthenticationError,
  createAuthorizationError,
  createNotFoundError,
  createRateLimitError,
  createDatabaseError,
  createOpenAIError,
  createCacheError,
  createFileError,
  createThirdPartyAPIError,
  createTimeoutError,
  asyncErrorHandler,
  formatError,
  OpenAIError,
};
