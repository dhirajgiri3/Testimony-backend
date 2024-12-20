// src/services/skillExtractionService.js

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
 * Retrieve cached skills from Redis.
 *
 * @param {string} text - The text to analyze.
 * @returns {Promise<Array<Object>|null>} - The cached skills or null.
 */
const getCachedSkills = async (text) => {
  const cacheKey = `skills:${hashText(text)}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for skills extraction: ${cacheKey}`);
      return JSON.parse(cached);
    }
  } catch (error) {
    logger.error('Error fetching skills from cache:', error);
  }
  return null;
};

/**
 * Store skills in Redis cache.
 *
 * @param {string} text - The text analyzed.
 * @param {Array<Object>} skills - The extracted skills.
 * @returns {Promise<void>}
 */
const setCachedSkills = async (text, skills) => {
  const cacheKey = `skills:${hashText(text)}`;
  try {
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(skills)); // Cache for 1 hour
    logger.info(`Skills cached for key: ${cacheKey}`);
  } catch (error) {
    logger.error('Error setting skills cache:', error);
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
 * Extract skills from testimonial texts using OpenAI with caching and retry logic.
 *
 * @param {Array<string>} testimonialTexts - Array of testimonial texts.
 * @returns {Promise<Array<Object>>} - Array of extracted skills with details.
 * @throws {AppError} - If skill extraction fails.
 */
export const extractSkills = async (testimonialTexts) => {
  const combinedText = testimonialTexts.join('\n');

  // Check cache first
  const cachedSkills = await getCachedSkills(combinedText);
  if (cachedSkills) {
    return cachedSkills;
  }

  const prompt = `
You are an expert in skills extraction. From the following testimonials, extract a list of skills mentioned along with the number of times each skill is mentioned and provide a brief context for each mention.

Testimonials:
${combinedText}

Return ONLY a JSON array with the following structure:
[
  {
    "skill": "Skill Name",
    "mentions": number,
    "context": "Brief context where the skill was mentioned."
  },
  ...
]
`;

  try {
    const skills = await retry(async () => {
      const response = await openai.createChatCompletion({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are an expert skills extraction assistant.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 1000,
      });

      const content = response.data.choices[0].message.content.trim();

      // Attempt to parse JSON
      let parsedSkills;
      try {
        parsedSkills = JSON.parse(content);
        if (!Array.isArray(parsedSkills)) {
          throw new Error('Skills extraction did not return an array.');
        }
      } catch (jsonErr) {
        logger.error('Failed to parse skills extraction JSON:', jsonErr);
        throw new AppError(
          'Skills extraction failed to parse the response.',
          500
        );
      }

      return parsedSkills;
    });

    // Cache the result
    await setCachedSkills(combinedText, skills);

    return skills;
  } catch (error) {
    logger.error('Error extracting skills:', error);
    throw new AppError('Skills extraction service failed.', 500);
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
  extractSkills,
};
