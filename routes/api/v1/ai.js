// src/routes/api/v1/ai.js

import express from 'express';
import {
  generateAITestimonialSuggestion,
  handleChatQuery,
  getAdvancedInsights,
} from '../../../controllers/aiController.js';
import { protect, authorize } from '../../../middlewares/auth.js';
import {
  aiProcessingRateLimiter,
  profileUpdateRateLimiter,
} from '../../../middlewares/rateLimiter.js';
import { chatValidation, createValidator } from '../../../utils/validators.js';
import { validateRequest } from '../../../middlewares/validate.js';
import { body } from 'express-validator';
import { param } from 'express-validator';

const router = express.Router();

// Generate AI testimonial suggestion (Seeker)
router.post(
  '/generate-testimonial',
  protect,
  authorize('seeker'),
  aiProcessingRateLimiter,
  createValidator([
    body('projectDetails')
      .notEmpty()
      .withMessage('Project details are required'),
    body('skills').optional().isArray().withMessage('Skills must be an array'),
    body('skills.*')
      .optional()
      .isString()
      .withMessage('Each skill must be a string'),
  ]),
  validateRequest,
  generateAITestimonialSuggestion
);

// Handle conversational queries (Seeker)
router.post(
  '/chat',
  protect,
  authorize('seeker'),
  createValidator([
    body('query').notEmpty().withMessage('Chat query is required'),
  ]),
  validateRequest,
  handleChatQuery
);

/**
 * @route   GET /api/v1/ai/insights/:seekerId
 * @desc    Get AI-driven advanced insights for a seeker
 * @access  Protected and Authorized
 */
router.get(
  '/insights/:seekerId',
  protect,
  authorize('seeker'),
  aiProcessingRateLimiter,
  createValidator([
    param('seekerId')
      .matches(/^[0-9a-fA-F]{24}$/)
      .withMessage('Invalid seeker ID'),
  ]),
  validateRequest,
  getAdvancedInsights
);

export default router;
