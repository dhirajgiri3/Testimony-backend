import Testimonial from "../models/Testimonial.js";
import ActivityLog from "../models/ActivityLog.js";
import Analytics from "../models/Analytics.js"; // Added missing import
import asyncHandler from "express-async-handler";
import { logger } from "../utils/logger.js";
import { enqueueAnalyticsUpdate } from "../services/analyticsService.js";
import { getAdvancedAnalytics } from "../services/advancedAnalyticsService.js";

export const getAnalytics = asyncHandler(async (req, res) => {
  try {
    // Input validation
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: "User authentication required"
      });
    }

    // Basic analytics
    const totalTestimonials = await Testimonial.countDocuments({
      seeker: req.user.id,
    });

    const testimonialsByStatus = await Testimonial.aggregate([
      { $match: { seeker: req.user._id } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Recent activity with error handling
    const recentActivity = await ActivityLog.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
      .catch(error => {
        logger.warn("Failed to fetch recent activity:", error);
        return [];
      });

    // Trend analysis
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
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Calculate completion metrics
    const completedTestimonials = testimonialsByStatus.find(
      (status) => status._id === "completed"
    )?.count || 0;

    const completionRate = totalTestimonials > 0
      ? ((completedTestimonials / totalTestimonials) * 100).toFixed(2)
      : 0;

    // Construct analytics object
    const analytics = {
      overview: {
        totalTestimonials,
        completionRate: parseFloat(completionRate),
        activeTestimonials: testimonialsByStatus.find(
          (status) => status._id === "active"
        )?.count || 0,
        completedTestimonials,
      },
      testimonialsByStatus,
      testimonialsTrend,
      recentActivity,
      lastUpdated: new Date(),
    };

    // Background tasks
    Promise.all([
      enqueueAnalyticsUpdate(req.user.id),
      getAdvancedAnalytics(req.user.id),
    ]).then(([_, advancedInsights]) => {
      // Store analytics for future reference
      Analytics.findOneAndUpdate(
        { seeker: req.user.id },
        { 
          ...analytics,
          advancedInsights 
        },
        { upsert: true, new: true }
      ).catch(error => logger.error("Failed to store analytics:", error));
    });

    res.status(200).json({
      success: true,
      data: analytics,
    });

  } catch (error) {
    logger.error("Error fetching analytics:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch analytics data",
      message: error.message
    });
  }
});
