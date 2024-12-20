// src/services/sentimentService.js

import { openai } from '../config/openAI.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
import { redisClient } from '../config/redis.js';
import crypto from 'crypto';

/**
 * Hash text using SHA-256.
 *
 * @param {string} text - The text to hash.
 * @returns {string} - The resulting hash.
 */
const hashText = (text) => {
  return crypto.createHash('sha256').update(text).digest('hex');
};

/**
 * Retrieve cached sentiment score from Redis.
 *
 * @param {string} text - The text to analyze.
 * @returns {Promise<number|null>} - The cached sentiment score or null.
 */
const getCachedSentiment = async (text) => {
  const cacheKey = `sentiment:${hashText(text)}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for sentiment analysis: ${cacheKey}`);
      return JSON.parse(cached);
    }
  } catch (error) {
    logger.error('Error fetching sentiment from cache:', error);
  }
  return null;
};

/**
 * Store sentiment score in Redis cache.
 *
 * @param {string} text - The text analyzed.
 * @param {number} sentiment - The sentiment score.
 * @returns {Promise<void>}
 */
const setCachedSentiment = async (text, sentiment) => {
  const cacheKey = `sentiment:${hashText(text)}`;
  try {
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(sentiment)); // Cache for 1 hour
    logger.info(`Sentiment cached for key: ${cacheKey}`);
  } catch (error) {
    logger.error('Error setting sentiment cache:', error);
  }
};

/**
 * Retry function with exponential backoff.
 *
 * @param {Function} fn - The function to retry.
 * @param {number} retries - Number of retry attempts.
 * @param {number} delay - Initial delay in milliseconds.
 * @returns {Promise<any>} - The result of the function.
 * @throws {Error} - If all retry attempts fail.
 */
const retry = async (fn, retries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      logger.warn(`Retry attempt ${attempt} failed. Retrying in ${delay}ms...`);
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2; // Exponential backoff
    }
  }
};

/**
 * Analyze sentiment for multiple texts with caching and retry logic.
 *
 * @param {Array<string>} texts - Array of texts to analyze.
 * @returns {Promise<Array<number|null>>} - Array of sentiment scores or null.
 * @throws {AppError} - If sentiment analysis fails.
 */
export const analyzeSentiment = async (texts) => {
  try {
    // Retrieve cached sentiments
    const cachedResults = await Promise.all(texts.map(getCachedSentiment));
    const results = cachedResults.map((cached) => cached || null);

    // Identify texts needing analysis
    const textsToAnalyze = texts.filter((_, index) => results[index] === null);

    if (textsToAnalyze.length === 0) {
      logger.info('All sentiments retrieved from cache.');
      return results;
    }

    // Batch processing with a reasonable batch size
    const batchSize = 5;
    for (let i = 0; i < textsToAnalyze.length; i += batchSize) {
      const batch = textsToAnalyze.slice(i, i + batchSize);

      const sentiments = await retry(
        async () => {
          const responses = await Promise.all(
            batch.map((text) =>
              openai.createCompletion({
                model: 'text-davinci-003',
                prompt: `Analyze the sentiment of the following text and provide a score between -1 (negative) and 1 (positive):\n\n"${text}"`,
                max_tokens: 10,
                temperature: 0,
              })
            )
          );

          return responses.map((response) => {
            const text = response.data.choices[0]?.text?.trim();
            const score = parseFloat(text);
            if (isNaN(score)) {
              logger.warn(`Invalid sentiment score received: "${text}"`);
              return null;
            }
            return score;
          });
        },
        3,
        1000
      );

      // Cache and assign results
      sentiments.forEach((sentiment, idx) => {
        const originalIndex = texts.indexOf(batch[idx]);
        results[originalIndex] = sentiment;
        if (sentiment !== null) {
          setCachedSentiment(batch[idx], sentiment);
        }
      });
    }

    return results;
  } catch (error) {
    logger.error('Sentiment analysis failed:', error);
    throw new AppError('Sentiment analysis service failed.', 500);
  }
};

/**
 * Perform detailed sentiment analysis using OpenAI Chat Completion.
 *
 * @param {Array<Object>} testimonials - Array of testimonial objects.
 * @returns {Promise<Object>} - Detailed sentiment analysis results.
 * @throws {AppError} - If analysis fails.
 */
export const performSentimentAnalysis = async (testimonials) => {
  const testimonialTexts = testimonials
    .map((t) =>
      t.givers
        .map((g) => g.testimonial.text)
        .filter(Boolean)
        .join('\n')
    )
    .join('\n');

  const prompt = `
    You are an expert sentiment analysis assistant with advanced capabilities in understanding nuanced emotions and extracting detailed insights. Analyze the following testimonials and provide a comprehensive sentiment analysis report that includes:
    
    1. Overall sentiment classification (very positive, positive, neutral, mixed, negative, very negative).
    2. Detailed emotions detected with their respective intensities (e.g., happiness, sadness, anger, surprise, etc.).
    3. Common themes and topics mentioned in the testimonials.
    4. Specific praises and positive feedback highlighted.
    5. Specific criticisms and negative feedback highlighted.
    6. Suggestions for improvement based on the feedback provided.
    7. Any notable patterns or trends observed across the testimonials.
    
    Testimonials:
    ${testimonialTexts}
    
    Please return the analysis in a structured JSON format with clear sections for each of the requested points. Ensure the JSON is properly formatted and does not include any additional explanations or text outside the JSON object.
    `;

  try {
    const response = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a professional sentiment analysis assistant.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    });

    const content = response.data.choices[0].message.content.trim();

    // Attempt to parse JSON
    let sentimentData;
    try {
      sentimentData = JSON.parse(content);
    } catch (jsonErr) {
      logger.error('Failed to parse sentiment analysis JSON:', jsonErr);
      throw new AppError(
        'Sentiment analysis failed to parse the response.',
        500
      );
    }

    return sentimentData;
  } catch (error) {
    logger.error('Error performing sentiment analysis:', error);
    throw new AppError('Sentiment analysis service failed.', 500);
  }
};

/**
 * Ensure Redis client handles reconnections and errors gracefully.
 */
redisClient.on('error', (err) => {
  logger.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  logger.info('✅ Redis client connected');
});

redisClient.on('reconnecting', () => {
  logger.warn('⚠️ Redis client reconnecting');
});

export default {
  analyzeSentiment,
  performSentimentAnalysis,
};
