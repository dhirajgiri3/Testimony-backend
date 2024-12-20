// config/openAI.js-1

import dotenv from 'dotenv';
import { Configuration, OpenAIApi } from 'openai';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

dotenv.config();

// Ensure the OpenAI API key is provided
if (!process.env.OPENAI_API_KEY) {
  logger.error('❌ OPENAI_API_KEY is not defined.');
  throw new AppError('Missing OpenAI API key.', 500);
}

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openAi = new OpenAIApi(configuration);

/**
 * Verify OpenAI Connection by retrieving available models
 */
const testOpenAIConnection = async () => {
  try {
    const response = await openAi.listModels();
    if (
      response &&
      response.data &&
      response.data.data &&
      response.data.data.length > 0
    ) {
      logger.info(
        '✅ Successfully connected to OpenAI. Available models:',
        response.data.data
      );
    } else {
      logger.warn(
        '⚠️ OpenAI responded without model data. Please verify your API key and subscription plan.',
        response.data
      );
    }
  } catch (error) {
    logger.error(
      '❌ OpenAI connection failed:',
      error.response ? error.response.data : error.message
    );
    throw new AppError('Unable to connect to OpenAI.', 500);
  }
};

export { openAi, testOpenAIConnection };
