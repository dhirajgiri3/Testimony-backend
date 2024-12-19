import asyncHandler from "express-async-handler";
import queues from "../jobs/queues.js";
import AppError from "../utils/appError.js";
import Analytics from "../models/Analytics.js";
import { openai } from "../config/openAI.js";
import rateLimit from "express-rate-limit";
import { sanitizeInput } from "../utils/sanitizer.js";
import { logger } from "../utils/logger.js";
import { body, validationResult } from 'express-validator';

// Rate limiting for AI endpoints
export const aiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: "Too many requests from this IP, please try again later"
});

/**
 * @desc    Generate AI Testimonial Suggestion
 * @route   POST /api/v1/ai/generate-testimonial
 * @access  Private (Seeker)
 */
export const generateAITestimonialSuggestion = [
  aiRateLimiter,
  body('projectDetails').isString().withMessage('Project details must be a string'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { projectDetails } = req.body;

    // Input validation
    if (!projectDetails || typeof projectDetails !== 'string') {
      throw new AppError("Valid project details are required", 400);
    }

    // Sanitize input
    const sanitizedDetails = sanitizeInput(projectDetails);

    try {
      // Enqueue AI testimonial generation job
      const job = await queues.aiQueue.add(
        "generateAITestimonial",
        {
          projectDetails: sanitizedDetails,
          userId: req.user.id,
          timestamp: new Date().toISOString()
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
          removeOnComplete: true,
          removeOnFail: false
        }
      );

      res.status(202).json({
        success: true,
        message: "AI testimonial generation started. You will receive the result shortly.",
        jobId: job.id
      });
    } catch (error) {
      logger.error("AI testimonial generation error:", error);
      throw new AppError("Failed to start AI generation process", 500);
    }
  })
];

/**
 * @desc    Handle Conversational Analytics Queries
 * @route   POST /api/v1/ai/chat
 * @access  Private (Seeker)
 */
export const handleChatQuery = [
  aiRateLimiter,
  body('query').isString().withMessage('Query must be a string'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { query } = req.body;

    // Input validation
    if (!query || typeof query !== 'string') {
      throw new AppError("Valid query is required", 400);
    }

    const sanitizedQuery = sanitizeInput(query);

    try {
      // Fetch user's analytics data
      const analytics = await Analytics.findOne({ seeker: req.user.id })
        .lean()
        .select('-_id -__v');

      if (!analytics) {
        throw new AppError("No analytics data available", 404);
      }

      // Generate AI response using OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an analytics assistant helping to interpret testimonial data."
          },
          {
            role: "user",
            content: `Analytics context: ${JSON.stringify(analytics)}\n\nQuery: ${sanitizedQuery}`
          }
        ],
        max_tokens: 500
      });

      const aiResponse = completion.choices[0].message.content;

      // Log the interaction
      logger.info(`AI Chat Query processed for user ${req.user.id}`);

      res.status(200).json({
        success: true,
        response: aiResponse,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error("AI chat error:", error);
      throw new AppError(error.message || "Failed to process chat query", 500);
    }
  })
];

/**
 * @desc    Get Advanced Insights
 * @route   POST /api/v1/ai/advanced-insights
 * @access  Private (Seeker)
 */
export const getAdvancedInsights = [
  aiRateLimiter,
  body('insightsQuery').isString().withMessage('Insights query must be a string'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { insightsQuery } = req.body;

    // Input validation
    if (!insightsQuery || typeof insightsQuery !== 'string') {
      throw new AppError("Valid insights query is required", 400);
    }

    const sanitizedQuery = sanitizeInput(insightsQuery);

    try {
      // Fetch user's analytics data
      const analytics = await Analytics.findOne({ seeker: req.user.id })
        .lean()
        .select('-_id -__v');

      if (!analytics) {
        throw new AppError("No analytics data available", 404);
      }

      // Generate AI insights using OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an analytics assistant providing advanced insights based on testimonial data."
          },
          {
            role: "user",
            content: `Analytics context: ${JSON.stringify(analytics)}\n\nInsights Query: ${sanitizedQuery}`
          }
        ],
        max_tokens: 500
      });

      const aiResponse = completion.choices[0].message.content;

      // Log the interaction
      logger.info(`Advanced Insights Query processed for user ${req.user.id}`);

      res.status(200).json({
        success: true,
        response: aiResponse,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error("Advanced Insights error:", error);
      throw new AppError(error.message || "Failed to process insights query", 500);
    }
  })
];

export default {
  generateAITestimonialSuggestion,
  handleChatQuery,
  getAdvancedInsights
};
