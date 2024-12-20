// src/services/recommendationService.js

import { logger } from '../utils/logger.js';
import { openai } from '../config/openAI.js';
import AppError from '../utils/appError.js';

/**
 * Generate personalized recommendations using OpenAI based on analytics data.
 *
 * @param {Object} analyticsData - Must include relevant performance metrics.
 * @returns {Promise<string>}
 * @throws {AppError}
 */
export const generateRecommendations = async (analyticsData = {}) => {
  if (!Object.keys(analyticsData).length) {
    logger.warn('Received empty analytics data.');
    return 'No analytics data provided.';
  }

  try {
    const prompt = `
  You are a top-tier professional career advisor with extensive domain expertise. Here is the analytics data to analyze:
  ${JSON.stringify(analyticsData, null, 2)}

  Please provide a comprehensive, data-driven evaluation that identifies strengths, weaknesses, and potential growth paths. Recommend specific, personalized strategies for immediate short-term improvements and long-term career development, including skill enhancement and networking approaches where relevant. Offer actionable and clearly reasoned advice while maintaining a concise, instructive tone.

  Recommendations:
  `;
    const response = await openai.createCompletion({
      model: 'gpt-4',
      prompt,
      max_tokens: 500,
      temperature: 0.7,
      n: 1,
      stop: ['\n\n']
    });

    const recommendations = response.data.choices[0]?.text?.trim();
    if (!recommendations) {
      logger.warn('OpenAI returned empty recommendations.');
      return 'No recommendations available.';
    }

    return recommendations;
  } catch (error) {
    logger.error('Error generating recommendations:', error);
    throw new AppError('Failed to generate recommendations.', 500);
  }
};

export default {
  generateRecommendations
};
