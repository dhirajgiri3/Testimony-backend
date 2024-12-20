// src/routes/api/v1/analytics.js

import express from 'express';
import {
  getAnalytics,
  enqueueAnalyticsUpdate,
} from '../../../services/analyticsService.js';
import { protect } from '../../../middlewares/auth.js';

const router = express.Router();

/**
 * @route   GET /api/v1/analytics/:seekerId
 * @desc    Get advanced analytics for a seeker
 * @access  Protected
 */
router.get('/:seekerId', protect, async (req, res, next) => {
  try {
    const analytics = await getAnalytics(req.params.seekerId);
    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/v1/analytics/:seekerId/update
 * @desc    Enqueue analytics update job for a seeker
 * @access  Protected
 */
router.post('/:seekerId/update', protect, async (req, res, next) => {
  try {
    await enqueueAnalyticsUpdate(req.params.seekerId);
    res.status(200).json({
      success: true,
      message: 'Analytics update job enqueued.',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
