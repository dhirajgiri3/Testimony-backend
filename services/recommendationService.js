// src/services/recommendationService.js

import { logger } from '../utils/logger.js';
import { openai } from '../config/openAI.js';

/**
 * Generate Personalized Recommendations using OpenAI
 * @param {Object} analyticsData
 * @returns {string} Recommendations Text
 */
export const generateRecommendations = async (analyticsData) => {
  try {
    const prompt = `
    Based on the following analytics data for a professional, provide actionable recommendations to enhance their performance, skills, and growth. The recommendations should be personalized, strategic, and easy to implement.

    Analytics Data:
    ${JSON.stringify(analyticsData, null, 2)}

    Recommendations:
    `;

    const response = await openai.createCompletion({
      model: "gpt-4",
      prompt,
      max_tokens: 300,
      temperature: 0.7,
      n: 1,
      stop: ["\n\n"],
    });

    const recommendations = response.data.choices[0].text.trim();
    return recommendations;
  } catch (error) {
    logger.error('❌ Error generating recommendations:', error);
    return "No recommendations available at this time.";
  }
};

// No changes needed unless the structure of skills or sentimentData has been altered.
// If `extractSkills` or `performSentimentAnalysis` returns data in a different format,
// update the recommendation logic accordingly.