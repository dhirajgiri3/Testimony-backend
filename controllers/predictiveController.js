// src/controllers/predictiveController.js

import asyncHandler from 'express-async-handler';
import Analytics from '../models/Analytics.js';
import Testimonial from '../models/Testimonial.js';
import AppError from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import predictiveService from '../services/predictiveService.js';
import { logUserActivity } from '../services/activityLogService.js';

/**
 * Get Advanced Predictive Insights
 * @route GET /api/v1/predictive/insights
 * @access Private (Seeker)
 */
export const getPredictiveInsights = asyncHandler(async (req, res, next) => {
  const { timespan = '6months' } = req.query;

  if (!req.user?.id) {
    throw new AppError('User authentication required', 401);
  }

  try {
    // Fetch base analytics
    const analytics = await Analytics.findOne({ seeker: req.user.id }).lean();
    if (!analytics) {
      throw new AppError('No analytics data available', 404);
    }

    // Define time range based on timespan
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(endDate.getMonth() - (timespan === '12months' ? 12 : 6));

    // Fetch relevant testimonials
    const testimonials = await Testimonial.find({
      seeker: req.user.id,
      createdAt: { $gte: startDate, $lte: endDate },
    }).lean();

    // Generate predictive insights using predictiveService
    const predictiveData = await predictiveService.generatePredictiveInsights(
      testimonials,
      analytics
    );

    // Update analytics with new predictions
    await Analytics.findOneAndUpdate(
      { seeker: req.user.id },
      {
        forecast: predictiveData,
        lastPredictionUpdate: new Date(),
      },
      { new: true }
    );

    // Log predictive insights generation activity
    await logUserActivity(req.user.id, 'GENERATE_PREDICTIVE_INSIGHTS');

    res.status(200).json({
      success: true,
      data: predictiveData,
    });
  } catch (error) {
    logger.error('Error in predictive insights:', { error: error.message });
    throw new AppError('Failed to generate predictive insights', 500);
  }
});

/**
 * Get forecasted testimonials trend for a seeker
 * @route GET /api/v1/predictive/forecast/:seekerId
 * @access Private
 */
export const getForecast = asyncHandler(async (req, res, next) => {
  const { seekerId } = req.params;

  if (!seekerId) {
    throw new AppError('Seeker ID is required', 400);
  }

  try {
    const analytics = await Analytics.findOne({ seeker: seekerId }).lean();
    if (!analytics) {
      throw new AppError('No analytics data available', 404);
    }

    res.status(200).json({
      success: true,
      data: analytics.forecast,
    });
  } catch (error) {
    logger.error('Error in getting forecast:', { error: error.message });
    throw new AppError('Failed to get forecast', 500);
  }
});

export default {
  getPredictiveInsights,
  getForecast,
};
