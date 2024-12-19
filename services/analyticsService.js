// src/services/analyticsService.js

import Analytics from "../models/Analytics.js";
import Testimonial from "../models/Testimonial.js";
import Goal from "../models/Goal.js";
import User from "../models/User.js";
import ActivityLog from "../models/ActivityLog.js"; // Added missing import
import queues from "../jobs/queues.js";
import { logger } from "../utils/logger.js";
import { performSentimentAnalysis } from "./sentimentService.js";
import { extractSkills } from "./skillExtractionService.js";
import { forecastTestimonialsTrend } from "./forecastService.js";
import { generateRecommendations } from "./recommendationService.js";
import { updateIndustryTrends } from "./externalDataService.js";
import AppError from '../utils/appError.js'; // Added AppError import

/**
 * Modular function to process skills analytics
 */
const processSkills = async (seekerId) => {
  // Retrieve approved testimonials for the seeker
  const testimonials = await Testimonial.find({
    seeker: seekerId,
    "givers.isApproved": true,
  }).lean();

  // Extract skills using the external skill extraction service
  const skills = await extractSkills(testimonials);
  return skills;
};

/**
 * Modular function to process sentiment analytics
 */
const processSentiment = async (seekerId, sixMonthsAgo) => {
  // Retrieve approved testimonials within the last six months
  const testimonials = await Testimonial.find({
    seeker: seekerId,
    "givers.isApproved": true,
    "givers.submittedAt": { $gte: sixMonthsAgo },
  }).lean();

  // Perform sentiment analysis using the external sentiment analysis service
  const sentimentData = await performSentimentAnalysis(testimonials);
  return sentimentData;
};

/**
 * Modular function to process emotion distribution
 */
const processEmotionDistribution = async (seekerId) => {
  const emotionAggregation = await Testimonial.aggregate([
    { $match: { seeker: seekerId, "givers.isApproved": true } },
    { $unwind: "$givers" },
    {
      $match: {
        "givers.isApproved": true,
        "givers.emotionAnalysis": { $exists: true },
      },
    },
    { $unwind: { path: "$givers.emotionAnalysis" } },
    {
      $group: {
        _id: "$givers.emotionAnalysis.k",
        total: { $sum: "$givers.emotionAnalysis.v" },
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
 * Modular function to process project categories
 */
const processProjectCategories = async (seekerId) => {
  const projectCategoryAggregation = await Testimonial.aggregate([
    { $match: { seeker: seekerId, "givers.isApproved": true } },
    { $unwind: "$givers" },
    {
      $match: {
        "givers.isApproved": true,
        "givers.projectCategory": { $exists: true },
      },
    },
    {
      $group: {
        _id: "$givers.projectCategory",
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
 * Modular function to process skill correlation
 */
const processSkillCorrelation = async (seekerId) => {
  const skillCorrelationAggregation = await Testimonial.aggregate([
    { $match: { seeker: seekerId, "givers.isApproved": true } },
    { $unwind: "$givers" },
    {
      $match: {
        "givers.isApproved": true,
        "givers.skills": { $exists: true, $ne: [] },
      },
    },
    { $unwind: "$givers.skills" },
    {
      $group: {
        _id: "$givers.skills",
        relatedSkills: { $addToSet: "$givers.skills" },
        averageSentiment: { $avg: "$givers.sentimentScore" },
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
 * Modular function to process benchmarking
 */
const processBenchmarking = async (seekerId, industry) => {
  const industryAnalytics = await Testimonial.aggregate([
    { $match: { "seeker.industry": industry, "givers.isApproved": true } },
    { $unwind: "$givers" },
    { $match: { "givers.isApproved": true } },
    {
      $group: {
        _id: null,
        averageSentiment: { $avg: "$givers.sentimentScore" },
        averageTestimonialPerProject: {
          $avg: { $strLenCP: "$givers.testimonial" },
        },
        totalTestimonials: { $sum: 1 },
      },
    },
  ]);

  return {
    averageSentiment: industryAnalytics[0]?.averageSentiment
      ? parseFloat(industryAnalytics[0].averageSentiment.toFixed(2))
      : 0,
    averageTestimonialPerProject: industryAnalytics[0]
      ?.averageTestimonialPerProject
      ? parseFloat(
          industryAnalytics[0].averageTestimonialPerProject.toFixed(2)
        )
      : 0,
    totalTestimonials: industryAnalytics[0]?.totalTestimonials || 0,
  };
};

/**
 * Modular function to process goals
 */
const processGoalsData = (goals) => {
  const activeGoals = goals.filter((goal) => goal.status === "active");
  const completedGoals = goals.filter((goal) => goal.status === "completed");
  const expiredGoals = goals.filter((goal) => goal.status === "expired");

  return {
    total: goals.length,
    active: activeGoals.length,
    completed: completedGoals.length,
    expired: expiredGoals.length,
  };
};

/**
 * Update Analytics for a Seeker with enhanced processing and error handling
 * @param {string} seekerId - ID of the user
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
      goals
    ] = await Promise.all([
      processSkills(seekerId),
      processSentiment(seekerId, sixMonthsAgo),
      processEmotionDistribution(seekerId),
      processProjectCategories(seekerId),
      processSkillCorrelation(seekerId),
      processBenchmarking(seekerId, industry),
      forecastTestimonialsTrend(await getHistoricalData(seekerId)),
      updateIndustryTrends(seekerId, industry),
      Goal.find({ user: seekerId }).lean()
    ]);

    // Recommendations Generation
    const recommendationData = {
      totalRequests: await Testimonial.countDocuments({ seeker: seekerId }),
      totalTestimonials: await Testimonial.countDocuments({ seeker: seekerId, "givers.isApproved": true }),
      skills,
      sentimentOverview: sentimentData.overview,
      emotionDistribution,
      projectCategories,
      forecast: { testimonialsTrend: forecastData },
      benchmark,
      comparison: {
        sentimentAboveIndustry: sentimentData.overview.averageSentiment > benchmark.averageSentiment,
        testimonialVolumeAboveIndustry: await Testimonial.countDocuments({ seeker: seekerId, "givers.isApproved": true }) > benchmark.totalTestimonials,
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

    analytics.recentActivity = recentActivity.map(activity => ({
      activity: activity.action,
      timestamp: activity.createdAt,
    }));

    await analytics.save();

    logger.info(`✅ Analytics updated for seeker: ${seekerId}`);
  } catch (error) {
    logger.error("❌ Error updating analytics:", {
      seekerId,
      message: error.message,
      stack: error.stack
    });
    throw new AppError('Failed to update analytics', 500);
  }
};

/**
 * Enqueue Analytics Update Job
 * @param {string} seekerId - ID of the user
 */
export const enqueueAnalyticsUpdate = async (seekerId) => {
  await queues.analyticsQueue.add(
    "updateAnalytics",
    { seekerId },
    {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
    }
  );
};

/**
 * Get historical data for forecasting
 * @param {string} seekerId
 * @returns {Promise<Array>}
 */
const getHistoricalData = async (seekerId) => {
  const historicalData = await Testimonial.aggregate([
    {
      $match: {
        seeker: seekerId,
        "givers.isApproved": true
      }
    },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } }
  ]);

  return historicalData.map(item => ({
    ds: new Date(item._id.year, item._id.month - 1, 1).toISOString().split('T')[0],
    y: item.count
  }));
};

/**
 * Fetches all testimonials for a seeker and uses OpenAI to produce advanced analytics.
 * This includes skill extraction, sentiment analysis, predictive insights, improvement suggestions, etc.
 *
 * @param {string} seekerId - The seeker's user ID
 * @returns {Object} advancedInsights - Detailed AI-driven analytics
 */
export const getAnalytics = async (seekerId) => {
  // Fetch all testimonials text
  const testimonials = await Testimonial.find({
    seeker: seekerId,
    "givers.testimonial": { $exists: true, $ne: null },
  })
    .select(
      "givers.testimonial givers.name givers.email projectDetails createdAt"
    )
    .lean();

  if (!testimonials || testimonials.length === 0) {
    // If no testimonials, return empty advanced insights
    return {
      skills: [],
      sentimentAnalysis: {},
      improvementSuggestions: [],
      predictiveInsights: {},
      benchmarking: {},
      trendAnalysis: {},
    };
  }

  // Aggregate testimonial texts
  const testimonialTexts = testimonials.flatMap((t) =>
    t.givers
      .filter((g) => g.testimonial && g.isApproved)
      .map((g) => ({
        testimonial: g.testimonial,
        projectDetails: t.projectDetails,
        date: t.createdAt,
      }))
  );

  if (testimonialTexts.length === 0) {
    return {
      skills: [],
      sentimentAnalysis: {},
      improvementSuggestions: [],
      predictiveInsights: {},
      benchmarking: {},
      trendAnalysis: {},
    };
  }

  const prompt = `
You are an expert AI assistant that analyzes professional testimonials. 
You will receive a series of testimonials (real or hypothetical) about a professional (the "Seeker"). 
Your goal: Produce a JSON response with advanced analytics:

Requirements for the JSON fields:
- "skills": An array of objects { "skill": string, "mentions": number, "context": "why skill is valued" } extracted from testimonial text.
- "sentimentAnalysis": Object with fields:
   - "overallSentiment": "very positive", "positive", "mixed", "negative", etc.
   - "emotions": array of objects { "emotion": "trust/confidence/praise/etc.", "intensity": 0-1 }
   - "commonPraises": array of phrases frequently used
   - "commonCriticisms": array of phrases or aspects needing improvement
- "improvementSuggestions": array of strings, each is a recommendation to the Seeker on how to improve (based on criticisms or trends)
- "predictiveInsights": object with:
   - "futureDemandSkills": array of skill names that might be in higher demand soon
   - "forecast": string describing expected testimonial trend if improvements are made
- "benchmarking": object with:
   - "industryComparison": a qualitative statement (e.g., "You rank above average in communication compared to peers")
   - "topStrengthComparedToPeers": a skill or trait that is relatively stronger than average
- "trendAnalysis": object showing how sentiments or skill mentions changed over time (just describe a trend if possible)

Return ONLY the JSON object, without explanations.
Make sure the JSON is valid.
Here are the testimonials:

${testimonialTexts.map((t, i) => `Testimonial #${i + 1} (Date: ${t.date.toISOString()}): "${t.testimonial}" [Project: ${t.projectDetails}]`).join("\n")}
`;

  try {
    const response = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a professional analytics assistant.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    });

    const content = response.data.choices[0].message.content.trim();

    // Attempt to parse JSON
    let advancedInsights;
    try {
      advancedInsights = JSON.parse(content);
    } catch (jsonErr) {
      logger.error(
        "❌ Failed to parse AI response JSON, returning fallback structure.",
        jsonErr
      );
      // Fallback if parsing fails
      advancedInsights = {
        skills: [],
        sentimentAnalysis: {},
        improvementSuggestions: [],
        predictiveInsights: {},
        benchmarking: {},
        trendAnalysis: {},
        parsingError: true,
        rawResponse: content,
      };
    }

    return advancedInsights;
  } catch (error) {
    logger.error("❌ Error generating advanced analytics from OpenAI:", error);
    return {
      skills: [],
      sentimentAnalysis: {},
      improvementSuggestions: ["We encountered an error analyzing your data."],
      predictiveInsights: {},
      benchmarking: {},
      trendAnalysis: {},
      error: "AI analysis failed",
    };
  }
};
