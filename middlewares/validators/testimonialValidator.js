
// src/middlewares/validators/testimonialValidator.js

import { check, validationResult } from 'express-validator';

export const validateGetTestimonials = [
  check('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  check('limit')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Limit must be a positive integer'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    next();
  },
];

export const validateBulkAction = [
  check('testimonialIds')
    .isArray({ min: 1 })
    .withMessage('Testimonial IDs must be an array with at least one ID'),
  check('action')
    .isIn(['approve', 'reject'])
    .withMessage('Action must be either "approve" or "reject"'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    next();
  },
];