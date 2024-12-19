// src/utils/appError.js

const AppError = (message, statusCode = 500, type, cause) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
  error.isOperational = true;
  error.cause = cause;
  error.type = type;
  Error.captureStackTrace(error, AppError);
  return error;
};

export default AppError;
