// src/routes/api/v1/ai.js

import express from 'express';
import {
  generateAITestimonialSuggestion,
  handleChatQuery,
  getAdvancedInsights
} from '../../../controllers/aiController.js';
import { protect } from '../../../middlewares/auth.js';
import { authorize } from '../../../middlewares/role.js';
import { profileUpdateRateLimiter } from '../../../middlewares/rateLimiter.js';
import { chatValidation, createValidator } from '../../../utils/validators.js';
import { validateRequest } from '../../../middlewares/validate.js';

const router = express.Router();

// Generate AI testimonial suggestion (Seeker)
router.post(
  '/generate-testimonial',
  protect,
  authorize('seeker'),
  profileUpdateRateLimiter,
  generateAITestimonialSuggestion
);

// Handle conversational queries (Seeker)
router.post(
  '/chat',
  protect,
  authorize('seeker'),
  createValidator(chatValidation),
  validateRequest,
  handleChatQuery
);

/**
 * @route   GET /api/v1/ai/insights/:seekerId
 * @desc    Get AI-driven advanced insights for a seeker
 * @access  Protected
 */
router.get(
  '/insights/:seekerId',
  protect,
  authorize('seeker'),
  profileUpdateRateLimiter,
  getAdvancedInsights
);

export default router;