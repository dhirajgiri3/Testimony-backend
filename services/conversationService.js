// src/services/conversationService.js

import { openai } from '../config/openAI.js';
import { logger } from '../utils/logger.js';

/**
 * Generate AI Response for Conversational Queries
 * @param {string} userQuery
 * @param {Object} analyticsData
 * @returns {string} AI-generated response
 */
export const generateConversationResponse = async (userQuery, analyticsData) => {
  try {
    const prompt = `
    You are an intelligent analytics assistant. Based on the user's analytics data provided below, answer the user's question in a clear, concise, and informative manner.

    User Analytics Data:
    ${JSON.stringify(analyticsData, null, 2)}

    User Query:
    "${userQuery}"

    AI Response:
    `;

    const response = await openai.createCompletion({
      model: "gpt-4",
      prompt,
      max_tokens: 300,
      temperature: 0.7,
      n: 1,
      stop: ["\n\n"],
    });

    const aiResponse = response.data.choices[0].text.trim();
    return aiResponse;
  } catch (error) {
    logger.error('❌ Error generating conversation response:', error);
    return "I'm sorry, I couldn't process your request at the moment.";
  }
};