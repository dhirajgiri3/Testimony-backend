// src/services/conversationService.js

import { openai } from '../config/openAI.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
import { cacheManager } from '../middlewares/cache.js';
import { metrics } from '../utils/metrics.js';

/**
 * Handles a user's chat query by generating an AI response based on analytics data.
 *
 * @param {string} userQuery - The user's chat message.
 * @param {Object} analyticsData - The user's analytics data.
 * @returns {Promise<string>} The AI-generated response.
 */
export const generateConversationResponse = async (
  userQuery,
  analyticsData
) => {
  const sanitizedQuery = sanitizeInput(userQuery.trim());
  const cacheKey = cacheManager.generateKey(
    'conversation_response',
    sanitizedQuery
  );

  const cachedResponse = await cacheManager.get(cacheKey);
  if (cachedResponse) {
    logger.info('Cache hit for conversation response');
    return cachedResponse;
  }

  try {
    const prompt = `
      You are an intelligent analytics assistant. Based on the user's analytics data provided below, answer the user's question in a clear, concise, and informative manner.

      User Analytics Data:
      ${JSON.stringify(analyticsData, null, 2)}

      User Query:
      "${sanitizedQuery}"

      AI Response:
    `;

    const response = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful analytics assistant.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const aiResponse = response.data.choices[0].message.content.trim();
    await cacheManager.set(cacheKey, aiResponse, 3600); // Cache for 1 hour

    // Track metrics
    metrics.increment('conversation.responses.generated', 1, {
      query: sanitizedQuery,
    });

    return aiResponse;
  } catch (error) {
    logger.error('❌ Conversation Response Generation Failed:', error);
    metrics.increment('conversation.responses.error', 1, {
      query: sanitizedQuery,
    });
    throw new AppError('Failed to generate conversation response', 500);
  }
};
