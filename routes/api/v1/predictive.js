// src/routes/api/v1/predictive.js

import express from 'express';
import { getPredictiveInsights, getForecast } from '../../../controllers/predictiveController.js';
import { protect } from '../../../middlewares/auth.js';
import { authorize } from '../../../middlewares/role.js';

const router = express.Router();

// Get Predictive Insights
router.get(
  '/insights',
  protect,
  authorize('seeker'),
  getPredictiveInsights
);

/**
 * @route   GET /api/v1/predictive/forecast/:seekerId
 * @desc    Get forecasted testimonials trend for a seeker
 * @access  Protected
 */
router.get('/forecast/:seekerId', protect, getForecast);

export default router;