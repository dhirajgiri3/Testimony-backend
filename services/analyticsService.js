// src/services/analyticsService.js

import Analytics from '../models/Analytics.js';
import Testimonial from '../models/Testimonial.js';
import Goal from '../models/Goal.js';
import User from '../models/User.js';
import ActivityLog from '../models/ActivityLog.js';
import { queues } from '../jobs/queues.js';
import { logger } from '../utils/logger.js';
import { performSentimentAnalysis } from './sentimentService.js';
import { extractSkills } from './skillExtractionService.js';
import { forecastTestimonialsTrend } from './forecastService.js';
import { generateRecommendations } from './recommendationService.js';
import { updateIndustryTrends } from './externalDataService.js';
import AppError from '../utils/appError.js';

/**
 * Processes skills analytics for a seeker.
 *
 * @param {string} seekerId - ID of the user.
 * @returns {Promise<Object>} Extracted skills data.
 */
const processSkills = async (seekerId) => {
  const testimonials = await Testimonial.find({
    seeker: seekerId,
    'givers.isApproved': true,
  }).lean();

  const skills = await extractSkills(
    testimonials.map((t) => t.givers.testimonial)
  );
  return skills;
};

/**
 * Processes sentiment analytics for a seeker.
 *
 * @param {string} seekerId - ID of the user.
 * @param {Date} sixMonthsAgo - Date six months prior.
 * @returns {Promise<Object>} Sentiment analysis data.
 */
const processSentiment = async (seekerId, sixMonthsAgo) => {
  const testimonials = await Testimonial.find({
    seeker: seekerId,
    'givers.isApproved': true,
    createdAt: { $gte: sixMonthsAgo },
  }).lean();

  const sentimentData = await performSentimentAnalysis(
    testimonials.map((t) => t.givers.testimonial)
  );
  return sentimentData;
};

/**
 * Processes emotion distribution analytics for a seeker.
 *
 * @param {string} seekerId - ID of the user.
 * @returns {Promise<Object>} Emotion distribution data.
 */
const processEmotionDistribution = async (seekerId) => {
  const emotionAggregation = await Testimonial.aggregate([
    { $match: { seeker: seekerId, 'givers.isApproved': true } },
    { $unwind: '$givers' },
    {
      $match: {
        'givers.isApproved': true,
        'givers.emotionAnalysis': { $exists: true },
      },
    },
    { $unwind: '$givers.emotionAnalysis' },
    {
      $group: {
        _id: '$givers.emotionAnalysis.emotion',
        total: { $sum: '$givers.emotionAnalysis.intensity' },
      },
    },
    { $sort: { total: -1 } },
  ]);

  const emotionsMap = {};
  emotionAggregation.forEach((emotion) => {
    emotionsMap[emotion._id.toLowerCase()] = emotion.total;
  });

  return emotionsMap;
};

/**
 * Processes project category analytics for a seeker.
 *
 * @param {string} seekerId - ID of the user.
 * @returns {Promise<Array>} Array of project categories with counts.
 */
const processProjectCategories = async (seekerId) => {
  const projectCategoryAggregation = await Testimonial.aggregate([
    { $match: { seeker: seekerId, 'givers.isApproved': true } },
    { $unwind: '$givers' },
    {
      $match: {
        'givers.isApproved': true,
        'givers.projectCategory': { $exists: true },
      },
    },
    {
      $group: {
        _id: '$givers.projectCategory',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  return projectCategoryAggregation.map((category) => ({
    category: category._id,
    count: category.count,
  }));
};

/**
 * Processes skill correlation analytics for a seeker.
 *
 * @param {string} seekerId - ID of the user.
 * @returns {Promise<Array>} Array of skill correlations.
 */
const processSkillCorrelation = async (seekerId) => {
  const skillCorrelationAggregation = await Testimonial.aggregate([
    { $match: { seeker: seekerId, 'givers.isApproved': true } },
    { $unwind: '$givers' },
    {
      $match: {
        'givers.isApproved': true,
        'givers.skills': { $exists: true, $ne: [] },
      },
    },
    { $unwind: '$givers.skills' },
    {
      $group: {
        _id: '$givers.skills.skill',
        relatedSkills: { $addToSet: '$givers.skills.skill' },
        averageSentiment: { $avg: '$givers.sentimentScore' },
      },
    },
  ]);

  return skillCorrelationAggregation.map((skill) => ({
    skill: skill._id,
    averageSentiment: parseFloat(skill.averageSentiment.toFixed(2)),
    relatedSkills: skill.relatedSkills.filter((s) => s !== skill._id),
  }));
};

/**
 * Processes benchmarking analytics against industry standards.
 *
 * @param {string} seekerId - ID of the user.
 * @param {string} industry - Industry of the user.
 * @returns {Promise<Object>} Benchmarking data.
 */
const processBenchmarking = async (seekerId, industry) => {
  const industryAnalytics = await Testimonial.aggregate([
    {
      $match: {
        'seeker.industry': industry,
        'givers.isApproved': true,
      },
    },
    {
      $group: {
        _id: null,
        averageSentiment: { $avg: '$givers.sentimentScore' },
        averageTestimonialLength: {
          $avg: { $strLenCP: '$givers.testimonial' },
        },
        totalTestimonials: { $sum: 1 },
      },
    },
  ]);

  return {
    averageSentiment: industryAnalytics[0]?.averageSentiment
      ? parseFloat(industryAnalytics[0].averageSentiment.toFixed(2))
      : 0,
    averageTestimonialLength: industryAnalytics[0]?.averageTestimonialLength
      ? parseFloat(industryAnalytics[0].averageTestimonialLength.toFixed(2))
      : 0,
    totalTestimonials: industryAnalytics[0]?.totalTestimonials || 0,
  };
};

/**
 * Processes goal-related analytics for a seeker.
 *
 * @param {Array<Object>} goals - Array of goal documents.
 * @returns {Object} Processed goals data.
 */
const processGoalsData = (goals) => {
  const activeGoals = goals.filter((goal) => goal.status === 'active');
  const completedGoals = goals.filter((goal) => goal.status === 'completed');
  const expiredGoals = goals.filter((goal) => goal.status === 'expired');

  return {
    total: goals.length,
    active: activeGoals.length,
    completed: completedGoals.length,
    expired: expiredGoals.length,
  };
};

/**
 * Updates analytics for a seeker by aggregating various analytics components.
 *
 * @param {string} seekerId - ID of the user.
 */
export const updateAnalytics = async (seekerId) => {
  try {
    let analytics = await Analytics.findOne({ seeker: seekerId });

    if (!analytics) {
      analytics = await Analytics.create({ seeker: seekerId });
    }

    const seeker = await User.findById(seekerId).lean();
    if (!seeker) {
      throw new AppError('Seeker not found', 404);
    }
    const industry = seeker.industry;

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // Parallel processing of different analytics components
    const [
      skills,
      sentimentData,
      emotionDistribution,
      projectCategories,
      skillCorrelation,
      benchmark,
      forecastData,
      externalTrends,
      goals,
    ] = await Promise.all([
      processSkills(seekerId),
      processSentiment(seekerId, sixMonthsAgo),
      processEmotionDistribution(seekerId),
      processProjectCategories(seekerId),
      processSkillCorrelation(seekerId),
      processBenchmarking(seekerId, industry),
      forecastTestimonialsTrend(await getHistoricalData(seekerId)),
      updateIndustryTrends(seekerId, industry),
      Goal.find({ user: seekerId }).lean(),
    ]);

    // Recommendations Generation
    const recommendationData = {
      totalRequests: await Testimonial.countDocuments({ seeker: seekerId }),
      totalTestimonials: await Testimonial.countDocuments({
        seeker: seekerId,
        'givers.isApproved': true,
      }),
      skills,
      sentimentOverview: sentimentData.overview,
      emotionDistribution,
      projectCategories,
      forecast: { testimonialsTrend: forecastData },
      benchmark,
      comparison: {
        sentimentAboveIndustry:
          sentimentData.overview.averageSentiment > benchmark.averageSentiment,
        testimonialVolumeAboveIndustry:
          (await Testimonial.countDocuments({
            seeker: seekerId,
            'givers.isApproved': true,
          })) > benchmark.totalTestimonials,
      },
      goals: processGoalsData(goals),
    };

    const recommendations = await generateRecommendations(recommendationData);

    // Update Analytics Document
    analytics.totalRequests = recommendationData.totalRequests;
    analytics.totalTestimonials = recommendationData.totalTestimonials;
    analytics.skills = skills;
    analytics.sentimentOverview = sentimentData.overview;
    analytics.sentimentTrend = sentimentData.trend;
    analytics.emotionDistribution = emotionDistribution;
    analytics.projectCategories = projectCategories;
    analytics.skillCorrelation = skillCorrelation;
    analytics.forecast = {
      testimonialsTrend: forecastData,
    };
    analytics.benchmark = benchmark;
    analytics.comparison = recommendationData.comparison;
    analytics.goals = recommendationData.goals;
    analytics.recommendations = recommendations;
    analytics.externalTrends = externalTrends;
    analytics.updatedAt = new Date();

    // Update Recent Activity
    const recentActivity = await ActivityLog.find({ user: seekerId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    analytics.recentActivity = recentActivity.map((activity) => ({
      activity: activity.action,
      timestamp: activity.createdAt,
    }));

    await analytics.save();

    logger.info(`✅ Analytics updated for seeker: ${seekerId}`);
  } catch (error) {
    logger.error('❌ Error updating analytics:', {
      seekerId,
      message: error.message,
      stack: error.stack,
    });
    throw new AppError('Failed to update analytics', 500);
  }
};

/**
 * Enqueues an analytics update job for a seeker.
 *
 * @param {string} seekerId - ID of the user.
 */
export const enqueueAnalyticsUpdate = async (seekerId) => {
  try {
    await queues.analyticsQueue.add(
      'updateAnalytics',
      { seekerId },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      }
    );
    logger.info(`Enqueued analytics update job for seeker: ${seekerId}`);
  } catch (error) {
    logger.error(
      `❌ Failed to enqueue analytics update job for seeker: ${seekerId}`,
      error
    );
    throw new AppError('Failed to enqueue analytics update job', 500);
  }
};

/**
 * Retrieves historical testimonial data for forecasting.
 *
 * @param {string} seekerId - ID of the user.
 * @returns {Promise<Array<Object>>} Array of historical data points.
 */
const getHistoricalData = async (seekerId) => {
  const historicalData = await Testimonial.aggregate([
    {
      $match: {
        seeker: seekerId,
        'givers.isApproved': true,
      },
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  return historicalData.map((item) => ({
    ds: new Date(item._id.year, item._id.month - 1, 1)
      .toISOString()
      .split('T')[0],
    y: item.count,
  }));
};

/**
 * Retrieves advanced analytics for a seeker.
 *
 * @param {string} seekerId - ID of the user.
 * @returns {Promise<Object>} Advanced analytics data.
 */
export const getAdvancedInsights = async (seekerId) => {
  try {
    // Fetch seeker data
    const seeker = await User.findById(seekerId).lean();
    if (!seeker) {
      throw new AppError('Seeker not found', 404);
    }

    const analytics = await Analytics.findOne({ seeker: seekerId }).lean();
    if (!analytics) {
      throw new AppError('Analytics data not found', 404);
    }

    return analytics;
  } catch (error) {
    logger.error('❌ Get Advanced Insights Error:', error);
    throw new AppError('Failed to retrieve advanced insights', 500);
  }
};

const analyticsService = {
  updateAnalytics,
  enqueueAnalyticsUpdate,
  getAdvancedInsights,
};

export default analyticsService;
