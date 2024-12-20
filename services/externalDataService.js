import googleTrends from 'google-trends-api';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
import { createCacheManager, cacheManager } from '../middlewares/cache.js';

// Create a dedicated cache manager for Google Trends
const trendsCache = createCacheManager('trends');

/**
 * Fetches Google Trends data with retry mechanism, input validation, and Redis caching.
 * @param {Array<string>} keywords - List of keywords to fetch Google Trends data for.
 * @param {Object} options - Options for trends API request.
 * @param {string} [options.geo='global'] - Geographic region (default is 'global').
 * @param {string} [options.timeRange='PAST_12_MONTHS'] - Time range for data (default is 'PAST_12_MONTHS').
 * @param {string} [options.category=''] - Category filter for trends.
 * @returns {Promise<Object>} - Formatted Google Trends data.
 * @throws {AppError} - Throws error if request fails after retries.
 */
export const fetchGoogleTrends = async (keywords, options = {}) => {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new AppError('Keywords must be a non-empty array', 400);
  }

  const MAX_RETRIES = parseInt(process.env.GT_MAX_RETRIES, 10) || 3;
  const CACHE_TTL = parseInt(process.env.GT_CACHE_TTL, 10) || 3600; // Default 1 hour
  const {
    geo = 'global',
    timeRange = 'PAST_12_MONTHS',
    category = '',
  } = options;

  // Create a unique cache key based on input parameters
  const sortedKeywords = [...keywords].sort();
  const cacheKey = cacheManager.generateKey(
    'trends',
    sortedKeywords.join('_'),
    geo,
    timeRange,
    category
  );

  try {
    // Attempt to get data from cache
    return await trendsCache.getOrSet(
      cacheKey,
      async () => {
        let lastError;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            logger.info(
              `🔍 Attempt ${attempt} to fetch Google Trends for: ${sortedKeywords}`
            );

            const results = await googleTrends.interestOverTime({
              keyword: sortedKeywords,
              startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // Past 12 months
              geo,
              category,
            });

            const parsedResults = JSON.parse(results);
            const formattedData = parsedResults.default.timelineData.map(
              (item) => ({
                timestamp: new Date(item.time * 1000).toISOString(),
                values: item.value,
                keywords: sortedKeywords,
                formattedTime: item.formattedTime,
                formattedAxisTime: item.formattedAxisTime,
              })
            );

            return {
              data: formattedData,
              metadata: {
                fetchedAt: new Date().toISOString(),
                region: geo,
                keywords: sortedKeywords,
                timeRange,
                category,
              },
            };
          } catch (error) {
            lastError = error;
            logger.warn(`❌ Attempt ${attempt} failed for fetchGoogleTrends`, {
              error: error.message,
              attempt,
              keywords: sortedKeywords,
              geo,
              category,
            });

            // Exponential backoff before retrying
            const backoff = attempt * 2000; // Exponential backoff
            await new Promise((resolve) => setTimeout(resolve, backoff));
          }
        }

        throw lastError;
      },
      CACHE_TTL
    );
  } catch (error) {
    logger.error('❌ Error fetching Google Trends:', {
      error: error.message,
      keywords: sortedKeywords,
      geo,
      category,
      timeRange,
    });
    throw new AppError('Failed to fetch Google Trends data', 500);
  }
};

/**
 * Fetches and analyzes industry trends.
 * Uses Google Trends to analyze the popularity of industry-specific keywords.
 * @param {string} industry - Industry name (e.g., "Web Development").
 * @returns {Promise<Object>} - Processed trend analysis data.
 * @throws {AppError} - Throws error if trends data is unavailable.
 */
export const updateIndustryTrends = async (industry) => {
  if (!industry) {
    throw new AppError('Industry name is required', 400);
  }

  const industryKeywords = getIndustryKeywords(industry);
  if (!industryKeywords || industryKeywords.length === 0) {
    throw new AppError(`No keywords defined for industry: ${industry}`, 400);
  }

  try {
    const batchSize = 5;
    const batchPromises = [];

    for (let i = 0; i < industryKeywords.length; i += batchSize) {
      const batch = industryKeywords.slice(i, i + batchSize);
      batchPromises.push(
        fetchGoogleTrends(batch, { geo: 'US', timeRange: 'PAST_12_MONTHS' })
      );
    }

    const batchResults = await Promise.allSettled(batchPromises);
    const successfulResults = batchResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value.data)
      .flat();

    return {
      industry,
      updatedAt: new Date().toISOString(),
      trendsData: successfulResults,
      keywordCount: industryKeywords.length,
    };
  } catch (error) {
    logger.error('❌ Error updating industry trends', {
      error: error.message,
      industry,
    });
    throw new AppError('Failed to update industry trends', 500);
  }
};

/**
 * Returns predefined industry-specific keywords.
 * @param {string} industry - Name of the industry.
 * @returns {Array<string>} - Array of keywords for the given industry.
 */
const getIndustryKeywords = (industry) => {
  const INDUSTRY_KEYWORDS = {
    'Web Development': ['React', 'Angular', 'Node.js', 'Vue.js', 'TypeScript'],
    Marketing: ['SEO', 'Content Marketing', 'Social Media Marketing'],
    Design: ['UI Design', 'UX Research', 'Figma', 'Sketch'],
    'Data Science': [
      'Machine Learning',
      'Data Analysis',
      'Python',
      'TensorFlow',
    ],
  };

  return INDUSTRY_KEYWORDS[industry] || [];
};

/**
 * Invalidates cache for trends by specific industry or keyword.
 * @param {string|Array<string>} keys - Cache keys to invalidate.
 * @returns {Promise<void>}
 */
export const invalidateTrendCache = async (keys) => {
  try {
    if (!Array.isArray(keys)) keys = [keys];
    await Promise.all(keys.map((key) => trendsCache.delete(key)));
    logger.info(`✅ Cache invalidated for keys: ${keys.join(', ')}`);
  } catch (error) {
    logger.error('❌ Cache invalidation error:', error);
  }
};

export default {
  fetchGoogleTrends,
  updateIndustryTrends,
  getIndustryKeywords,
  invalidateTrendCache,
};
