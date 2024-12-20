import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
import { cacheManager } from '../middlewares/cache.js';
import { metrics } from '../utils/metrics.js';
import { openAi } from '../config/openAI.js';

/**
 * Handles OpenAI Errors by categorizing and logging them appropriately.
 *
 * @param {Error} error - The error object thrown by OpenAI methods.
 * @throws {Error} Re-throws categorized errors.
 */
function handleOpenAIError(error) {
  if (error.response) {
    // OpenAI API returned an error response
    const status = error.response.status;
    const errorCode = error.response.data?.error?.code;
    const errorMessage = error.response.data?.error?.message || error.message;

    if (status === 429) {
      logger.error('❌ Rate limit exceeded. Please try again later.');
      throw new AppError('Rate limit exceeded. Please try again later.', 429);
    } else if (errorCode === 'insufficient_quota') {
      logger.error('❌ Quota exceeded. Please upgrade your OpenAI plan.');
      throw new AppError(
        'Quota exceeded. Please upgrade your OpenAI plan.',
        403
      );
    } else {
      logger.error(`❌ OpenAI API Error: ${status} - ${errorMessage}`);
      throw new AppError(`OpenAI API Error: ${errorMessage}`, status);
    }
  } else if (error.request) {
    // No response received from OpenAI API
    logger.error(`❌ No response from OpenAI API: ${error.message}`);
    throw new AppError(
      'No response from AI service. Please try again later.',
      503
    );
  } else {
    // Other errors
    logger.error(`❌ OpenAI Service Error: ${error.message}`);
    throw new AppError('Failed to process request using AI service.', 500);
  }
}

/**
 * Generates a completion using OpenAI's API with caching and error handling.
 *
 * @param {Object} params - Parameters for the completion.
 * @param {string} params.prompt - The prompt for the AI.
 * @param {number} [params.maxTokens=150] - Maximum tokens for the completion.
 * @param {number} [params.temperature=0.7] - Temperature setting for the completion.
 * @param {string} [params.model='gpt-4'] - AI model to use.
 * @returns {Promise<string>} AI-generated completion.
 */
export const generateCompletion = async (params) => {
  const {
    prompt,
    maxTokens = 150,
    temperature = 0.7,
    model = 'gpt-4',
  } = params;

  if (!prompt) {
    throw new AppError('Prompt is required for completion generation.', 400);
  }

  const cacheKey = cacheManager.generateKey('openai_completion', prompt);

  try {
    const cachedResponse = await cacheManager.get(cacheKey);
    if (cachedResponse) {
      logger.info('🔄 Cache hit for OpenAI completion.');
      return cachedResponse;
    }

    const response = await openAi.createCompletion({
      model,
      prompt,
      max_tokens: maxTokens,
      temperature,
    });

    const completion = response.data.choices[0]?.text?.trim();
    if (!completion) {
      throw new AppError('No completion text received from OpenAI.', 500);
    }

    await cacheManager.set(cacheKey, completion, 3600); // Cache for 1 hour

    // Track metrics
    metrics.increment('openai.completions.generated', 1, { model });

    return completion;
  } catch (error) {
    handleOpenAIError(error);
  }
};

/**
 * Generates a chat completion using OpenAI's API with caching and error handling.
 *
 * @param {Object} params - Parameters for the chat completion.
 * @param {Array<Object>} params.messages - The conversation messages.
 * @param {number} [params.maxTokens=150] - Maximum tokens for the completion.
 * @param {number} [params.temperature=0.7] - Temperature setting for the completion.
 * @param {string} [params.model='gpt-4'] - AI model to use.
 * @returns {Promise<string>} AI-generated chat response.
 */
export const generateChatCompletion = async (params) => {
  const {
    messages,
    maxTokens = 150,
    temperature = 0.7,
    model = 'gpt-4',
  } = params;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new AppError(
      'Messages are required for chat completion generation.',
      400
    );
  }

  const prompt = messages
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join('\n');

  const cacheKey = cacheManager.generateKey('openai_chat_completion', prompt);

  try {
    const cachedResponse = await cacheManager.get(cacheKey);
    if (cachedResponse) {
      logger.info('🔄 Cache hit for OpenAI chat completion.');
      return cachedResponse;
    }

    const response = await openAi.createChatCompletion({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    });

    const chatResponse = response.data.choices[0]?.message?.content?.trim();
    if (!chatResponse) {
      throw new AppError('No chat response received from OpenAI.', 500);
    }

    await cacheManager.set(cacheKey, chatResponse, 3600); // Cache for 1 hour

    // Track metrics
    metrics.increment('openai.chat_completions.generated', 1, { model });

    return chatResponse;
  } catch (error) {
    handleOpenAIError(error);
  }
};

const openAiService = {
  generateCompletion,
  generateChatCompletion,
};

export default openAiService;
