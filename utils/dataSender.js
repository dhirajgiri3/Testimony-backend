// utils/dataSender.js

/**
 * Send a standardized API response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {boolean} success - Success status
 * @param {any} data - Response data
 * @param {string} message - Optional message
 * @param {Object} [options] - Additional options for the response
 */
const sendResponse = (
  res,
  statusCode = 200,
  success = true,
  data = null,
  message = '',
  options = {}
) => {
  const response = {
    success,
    ...(data && { data }),
    ...(message && { message }),
    ...options,
  };

  res.status(statusCode).json(response);
};

export { sendResponse };
