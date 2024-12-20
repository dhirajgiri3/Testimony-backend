// utils/validation.js

import AppError from './appError.js';
import { increment } from './metrics.js';

/**
 * Validate required environment variables
 */
const validateEnvVars = () => {
  const requiredVars = [
    'PORT',
    'MONGO_URI',
    'REDIS_HOST',
    'REDIS_PORT',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'OPENAI_API_KEY',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'EMAIL_SERVICE',
    'EMAIL_USER',
    'EMAIL_PASSWORD',
    'RATE_LIMIT_WINDOW_MS',
    'RATE_LIMIT_MAX',
    'CSRF_SECRET',
    'TWO_FACTOR_ISSUER',
    'LOG_LEVEL',
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    increment('validation.missingEnvVars', missingVars.length);
    throw new AppError(
      `Missing required environment variables: ${missingVars.join(', ')}`,
      500
    );
  }
};

export { validateEnvVars };
