// src/middlewares/validate.js

import { validationResult } from 'express-validator';
import AppError from '../utils/appError.js';

/**
 * Middleware to validate request using express-validator
 */
export const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const extractedErrors = errors
      .array()
      .map((err) => err.msg)
      .join(', ');
    throw new AppError(extractedErrors, 400);
  }
  next();
};
