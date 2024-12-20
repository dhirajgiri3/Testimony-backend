// src/services/nlpService.js

import { pipeline } from '@huggingface/transformers';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
import { cacheManager } from '../middlewares/cache.js';
import { metrics } from '../utils/metrics.js';
import dotenv from 'dotenv';
import { sanitizeInput } from '../utils/sanitizer.js';
import { openAi } from '../config/openAI.js';

dotenv.config();

let sentimentPipeline, emotionPipeline, nerPipeline;

const initializePipelines = async () => {
  try {
    sentimentPipeline = await pipeline('sentiment-analysis');
    emotionPipeline = await pipeline('text-classification', {
      model: 'j-hartmann/emotion-english-distilroberta-base',
    });
    nerPipeline = await pipeline('ner', { grouped_entities: true });

    logger.info('NLP pipelines initialized successfully.');
  } catch (error) {
    logger.error('❌ Failed to initialize NLP pipelines:', error);
    throw new AppError('Failed to initialize NLP pipelines', 500);
  }
};

const performSentimentAnalysis = async (text) => {
  try {
    const sentiment = await sentimentPipeline(text);
    return sentiment[0];
  } catch (error) {
    logger.error('❌ Sentiment Analysis Failed:', error);
    throw new AppError('Failed to perform sentiment analysis', 500);
  }
};

const performEmotionDetection = async (text) => {
  try {
    const emotions = await emotionPipeline(text);
    return emotions;
  } catch (error) {
    logger.error('❌ Emotion Detection Failed:', error);
    throw new AppError('Failed to perform emotion detection', 500);
  }
};

const extractNamedEntities = async (text) => {
  try {
    const entities = await nerPipeline(text);
    return entities;
  } catch (error) {
    logger.error('❌ Named Entity Recognition Failed:', error);
    throw new AppError('Failed to extract named entities', 500);
  }
};

const extractKeyPhrases = (text) => {
  const words = text.toLowerCase().split(/\W+/);
  const phrases = [];

  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].length > 3 && words[i + 1].length > 3) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
    }
  }

  return [...new Set(phrases)];
};

const generateFeedback = async (testimonialText) => {
  try {
    const prompt = `Provide detailed feedback and suggest improvements for the following testimonial: "${testimonialText}"`;

    const response = await openAi.createCompletion({
      model: 'text-davinci-003',
      prompt,
      max_tokens: 150,
      temperature: 0.7,
    });

    const feedback = response.data.choices[0].text.trim();
    return feedback;
  } catch (error) {
    handleOpenAIError(error);
  }
};

const extractSkills = async (testimonialText) => {
  try {
    const prompt = `Extract and list key skills and qualities from this testimonial: "${testimonialText}"`;

    const response = await openAi.createCompletion({
      model: 'text-davinci-003',
      prompt,
      max_tokens: 100,
      temperature: 0.7,
    });

    const skills = response.data.choices[0].text
      .trim()
      .split(',')
      .map((s) => s.trim());
    return skills;
  } catch (error) {
    handleOpenAIError(error);
  }
};

const handleOpenAIError = (error) => {
  if (error.response) {
    const status = error.response.status;
    const errorCode = error.response.data?.error?.code;
    const errorMessage = error.response.data?.error?.message || error.message;

    if (status === 429) {
      logger.error('❌ Rate limit exceeded. Please try again later.');
      throw new AppError('Rate limit exceeded. Please try again later.', 429);
    } else if (errorCode === 'insufficient_quota') {
      logger.error('❌ Quota exceeded. Please upgrade your OpenAI plan.');
      throw new AppError('Quota exceeded. Please upgrade your OpenAI plan.', 403);
    } else {
      logger.error(`❌ OpenAI API Error: ${status} - ${errorMessage}`);
      throw new AppError(`OpenAI API Error: ${errorMessage}`, status);
    }
  } else if (error.request) {
    logger.error(`❌ No response from OpenAI API: ${error.message}`);
    throw new AppError('No response from AI service. Please try again later.', 503);
  } else {
    logger.error(`❌ OpenAI Service Error: ${error.message}`);
    throw new AppError('Failed to process request using AI service.', 500);
  }
};

const generateResponse = async (userMessage) => {
  try {
    const sanitizedMessage = sanitizeInput(userMessage.trim());
    const cacheKey = cacheManager.generateKey('chat_response', sanitizedMessage);

    const cachedResponse = await cacheManager.get(cacheKey);
    if (cachedResponse) {
      logger.info('Cache hit for chat response');
      return cachedResponse;
    }

    const response = await openAi.createChatCompletion({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: sanitizedMessage },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const aiResponse = response.data.choices[0].message.content.trim();
    await cacheManager.set(cacheKey, aiResponse, 3600); // Cache for 1 hour

    metrics.increment('nlp.chat.responses.generated', 1, { query: sanitizedMessage });

    return aiResponse;
  } catch (error) {
    logger.error('❌ Generate Response Failed:', error);
    metrics.increment('nlp.chat.responses.error', 1, { query: sanitizedMessage });
    throw new AppError('Failed to generate response', 500);
  }
};

const extractSkillsFromAI = async (text) => {
  try {
    const skills = await extractSkills(text);
    return skills;
  } catch (error) {
    logger.error('❌ Extract Skills from AI Failed:', error);
    throw new AppError('Failed to extract skills from testimonial', 500);
  }
};

const generateTestimonialFeedback = async (testimonialText) => {
  try {
    const feedback = await generateFeedback(testimonialText);
    return feedback;
  } catch (error) {
    logger.error('❌ Generate Testimonial Feedback Failed:', error);
    throw new AppError('Failed to generate testimonial feedback', 500);
  }
};

const generateChatResponse = async (userMessage) => {
  try {
    const response = await generateResponse(userMessage);
    return response;
  } catch (error) {
    logger.error('❌ Generate Chat Response Failed:', error);
    throw error;
  }
};

await initializePipelines();

export {
  performSentimentAnalysis,
  performEmotionDetection,
  extractNamedEntities,
  extractKeyPhrases,
  generateFeedback,
  extractSkills,
  generateResponse,
  extractSkillsFromAI,
  generateTestimonialFeedback,
  generateChatResponse,
};
