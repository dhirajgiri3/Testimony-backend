// src/controllers/aiController.js

import asyncHandler from 'express-async-handler';
import { queues } from '../jobs/queues.js';
import AppError from '../utils/appError.js';
import Analytics from '../models/Analytics.js';
import { openai } from '../config/openAI.js';
import rateLimit from 'express-rate-limit';
import { sanitizeInput } from '../utils/sanitizer.js';
import { logger } from '../utils/logger.js';
import { body, validationResult } from 'express-validator';
import aiService from '../services/aiService.js';

/**
 * Rate limiting middleware for AI endpoints
 */
export const aiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  handler: (req, res) => {
    throw new AppError(
      'Too many requests from this IP, please try again later',
      429
    );
  },
});

/**
 * Generate AI Testimonial Suggestion
 */
export const generateAITestimonialSuggestion = [
  aiRateLimiter,
  body('projectDetails')
    .isString()
    .withMessage('Project details must be a string'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400, errors.array());
    }

    const { projectDetails } = req.body;

    // Sanitize input
    const sanitizedDetails = sanitizeInput(projectDetails);

    try {
      // Enqueue AI testimonial generation job
      const job = await queues.aiQueue.add(
        'generateAITestimonial',
        {
          projectDetails: sanitizedDetails,
          userId: req.user.id,
          timestamp: new Date().toISOString(),
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        }
      );

      res.status(202).json({
        success: true,
        message:
          'AI testimonial generation started. You will receive the result shortly.',
        jobId: job.id,
      });
    } catch (error) {
      logger.error('AI testimonial generation error:', {
        error: error.message,
      });
      throw new AppError('Failed to start AI generation process', 500);
    }
  }),
];

/**
 * Handle AI Chat Query
 */
export const handleChatQuery = [
  aiRateLimiter,
  body('query').isString().withMessage('Query must be a string'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400, errors.array());
    }

    const { query } = req.body;

    // Sanitize input
    const sanitizedQuery = sanitizeInput(query);

    try {
      // Fetch user's analytics data
      const analytics = await Analytics.findOne({ seeker: req.user.id })
        .lean()
        .select('-_id -__v');

      if (!analytics) {
        throw new AppError('No analytics data available', 404);
      }

      // Generate AI response using aiService
      const aiResponse = await aiService.handleChatQuery(
        sanitizedQuery,
        analytics
      );

      // Log the interaction
      logger.info(`AI Chat Query processed for user ${req.user.id}`);

      res.status(200).json({
        success: true,
        response: aiResponse,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('AI chat error:', { error: error.message });
      throw new AppError(error.message || 'Failed to process chat query', 500);
    }
  }),
];

/**
 * Get Advanced Insights
 */
export const getAdvancedInsights = [
  aiRateLimiter,
  body('insightsQuery')
    .isString()
    .withMessage('Insights query must be a string'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Validation failed', 400, errors.array());
    }

    const { insightsQuery } = req.body;

    // Sanitize input
    const sanitizedQuery = sanitizeInput(insightsQuery);

    try {
      // Fetch user's analytics data
      const analytics = await Analytics.findOne({ seeker: req.user.id })
        .lean()
        .select('-_id -__v');

      if (!analytics) {
        throw new AppError('No analytics data available', 404);
      }

      // Generate AI insights using aiService
      const aiResponse = await aiService.getAdvancedInsights(
        sanitizedQuery,
        analytics
      );

      // Log the interaction
      logger.info(`Advanced Insights Query processed for user ${req.user.id}`);

      res.status(200).json({
        success: true,
        response: aiResponse,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Advanced Insights error:', { error: error.message });
      throw new AppError(
        error.message || 'Failed to process insights query',
        500
      );
    }
  }),
];

export default {
  generateAITestimonialSuggestion,
  handleChatQuery,
  getAdvancedInsights,
};
