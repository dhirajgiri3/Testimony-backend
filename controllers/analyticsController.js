// src/controllers/analyticsController.js

import asyncHandler from 'express-async-handler';
import Testimonial from '../models/Testimonial.js';
import ActivityLog from '../models/ActivityLog.js';
import Analytics from '../models/Analytics.js';
import { logger } from '../utils/logger.js';
import { enqueueAnalyticsUpdate } from '../services/analyticsService.js';
import { getAdvancedAnalytics } from '../services/advancedAnalyticsService.js';
import AppError from '../utils/appError.js';

/**
 * Get Analytics for the current user
 */
export const getAnalytics = asyncHandler(async (req, res, next) => {
  if (!req.user || !req.user.id) {
    throw new AppError('User authentication required', 401);
  }

  try {
    // Fetch basic analytics
    const totalTestimonials = await Testimonial.countDocuments({
      seeker: req.user.id,
    });

    const testimonialsByStatus = await Testimonial.aggregate([
      { $match: { seeker: req.user._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    // Fetch recent activity
    const recentActivity = await ActivityLog.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
      .catch((error) => {
        logger.warn('Failed to fetch recent activity:', error.message);
        return [];
      });

    // Fetch testimonials trend over the past 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const testimonialsTrend = await Testimonial.aggregate([
      {
        $match: {
          seeker: req.user._id,
          createdAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            month: { $month: '$createdAt' },
            year: { $year: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Calculate completion metrics
    const completedTestimonials =
      testimonialsByStatus.find((status) => status._id === 'completed')
        ?.count || 0;

    const completionRate =
      totalTestimonials > 0
        ? parseFloat(
            ((completedTestimonials / totalTestimonials) * 100).toFixed(2)
          )
        : 0;

    // Construct analytics object
    const analytics = {
      overview: {
        totalTestimonials,
        completionRate,
        activeTestimonials:
          testimonialsByStatus.find((status) => status._id === 'active')
            ?.count || 0,
        completedTestimonials,
      },
      testimonialsByStatus,
      testimonialsTrend,
      recentActivity,
      lastUpdated: new Date(),
    };

    // Enqueue background tasks for analytics updates
    enqueueAnalyticsUpdate(req.user.id);
    getAdvancedAnalytics(req.user.id).catch((error) =>
      logger.error('Failed to get advanced analytics:', error.message)
    );

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    logger.error('Error fetching analytics:', error.message);
    throw new AppError('Failed to fetch analytics data', 500);
  }
});

export default {
  getAnalytics,
};
