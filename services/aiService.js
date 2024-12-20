// src/services/aiService.js

import { openai } from '../config/openAI.js';
import { redisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
import crypto from 'crypto';
import { cacheManager } from '../middlewares/cache.js';
import { metrics } from '../utils/metrics.js';
import { sanitizeInput } from '../utils/sanitizer.js';
import { OpenAIError } from '../utils/errors.js';

/**
 * AI Configuration Constants
 */
const AI_CONFIG = {
  CACHE: {
    TTL: 24 * 60 * 60, // 24 hours
    PREFIX: 'ai_service',
    RETRY_TTL: 300, // 5 minutes for failed requests
  },
  RETRY: {
    MAX_ATTEMPTS: 3,
    BASE_DELAY: 1000,
    MAX_DELAY: 5000,
  },
  TIMEOUT: {
    DEFAULT: 10000, // 10 seconds
    LONG: 20000, // 20 seconds for complex operations
  },
  BATCH: {
    SIZE: 5,
    CONCURRENT_LIMIT: 3,
  },
  MODELS: {
    DEFAULT: 'gpt-4',
    FALLBACK: 'gpt-3.5-turbo',
  },
  ANALYSIS: {
    SKILL_THRESHOLD: 0.6,
    SENTIMENT_THRESHOLD: 0.7,
    MIN_TEXT_LENGTH: 20,
    MAX_TEXT_LENGTH: 5000,
  },
  RATE_LIMITS: {
    REQUESTS_PER_MIN: 50,
    TOKENS_PER_MIN: 10000,
  },
  ERROR_MESSAGES: {
    VALIDATION: 'Invalid input for AI processing',
    RATE_LIMIT: 'AI request rate limit exceeded',
    TIMEOUT: 'AI operation timed out',
    PROCESSING: 'Error processing AI request',
  },
};

/**
 * Testimonial Generation Configuration
 */
const TESTIMONIAL_CONFIG = {
  TONES: {
    PROFESSIONAL: 'professional',
    CASUAL: 'casual',
    ENTHUSIASTIC: 'enthusiastic',
    BALANCED: 'balanced',
  },
  LENGTHS: {
    SHORT: { min: 50, max: 150 },
    MEDIUM: { min: 150, max: 300 },
    LONG: { min: 300, max: 500 },
  },
  FOCUS_AREAS: {
    SKILLS: 'skills',
    IMPACT: 'impact',
    COLLABORATION: 'collaboration',
    LEADERSHIP: 'leadership',
    TECHNICAL: 'technical',
    SOFT_SKILLS: 'soft_skills',
  },
};

/**
 * Rate Limiter Implementation
 */
class AIRateLimiter {
  constructor() {
    this.requests = new Map();
    this.tokens = new Map();
  }

  /**
   * Checks if the user has exceeded the rate limit.
   *
   * @param {string} userId - The ID of the user.
   * @throws {AppError} If rate limit is exceeded.
   */
  async checkLimit(userId) {
    const now = Date.now();
    const minute = Math.floor(now / 60000);

    // Clean up old entries
    this.cleanup(minute);

    // Check requests
    const userRequests = this.requests.get(userId)?.get(minute) || 0;
    if (userRequests >= AI_CONFIG.RATE_LIMITS.REQUESTS_PER_MIN) {
      throw new AppError(AI_CONFIG.ERROR_MESSAGES.RATE_LIMIT, 429);
    }

    // Update request count
    if (!this.requests.has(userId)) {
      this.requests.set(userId, new Map());
    }
    this.requests.get(userId).set(minute, userRequests + 1);
  }

  /**
   * Cleans up old rate limit entries.
   *
   * @param {number} currentMinute - The current minute.
   */
  cleanup(currentMinute) {
    for (const [userId, minutes] of this.requests.entries()) {
      for (const minute of minutes.keys()) {
        if (minute < currentMinute) {
          minutes.delete(minute);
        }
      }
    }
  }
}

const rateLimiter = new AIRateLimiter();

/**
 * Circuit Breaker Implementation
 */
class CircuitBreaker {
  constructor() {
    this.failures = 0;
    this.lastFailure = null;
    this.state = 'CLOSED';
  }

  /**
   * Executes an operation with circuit breaker protection.
   *
   * @param {Function} operation - The async operation to execute.
   * @param {Object} context - Contextual information for logging.
   * @returns {Promise<any>} The result of the operation.
   * @throws {Error} If the circuit is open or the operation fails.
   */
  async execute(operation, context) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure < 30000) {
        // 30 seconds cooling period
        throw new AppError('Circuit breaker is OPEN', 503);
      }
      this.state = 'HALF-OPEN';
    }

    try {
      const result = await operation();
      if (this.state === 'HALF-OPEN') {
        this.reset();
      }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Records a failure and potentially opens the circuit.
   */
  recordFailure() {
    this.failures += 1;
    this.lastFailure = Date.now();
    if (this.failures >= 5) {
      // 5 consecutive failures
      this.state = 'OPEN';
      logger.warn('Circuit breaker opened due to repeated failures.');
    }
  }

  /**
   * Resets the circuit breaker to CLOSED state.
   */
  reset() {
    this.failures = 0;
    this.lastFailure = null;
    this.state = 'CLOSED';
    logger.info('Circuit breaker reset to CLOSED.');
  }
}

const circuitBreaker = new CircuitBreaker();

/**
 * Retry Mechanism with Exponential Backoff
 *
 * @param {Function} operation - The async operation to retry.
 * @param {Object} options - Retry options.
 * @returns {Promise<any>} The result of the operation.
 * @throws {Error} If all retry attempts fail.
 */
const retryWithBackoff = async (operation, options = {}) => {
  const {
    maxAttempts = AI_CONFIG.RETRY.MAX_ATTEMPTS,
    baseDelay = AI_CONFIG.RETRY.BASE_DELAY,
    maxDelay = AI_CONFIG.RETRY.MAX_DELAY,
    context = {},
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const startTime = Date.now();
      const result = await Promise.race([
        operation(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Operation timeout')),
            options.timeout || AI_CONFIG.TIMEOUT.DEFAULT
          )
        ),
      ]);

      // Track metrics
      metrics.timing('ai.operation.duration', Date.now() - startTime, {
        operation: context.operation,
        attempt,
        success: true,
      });

      return result;
    } catch (error) {
      lastError = error;
      metrics.increment('ai.operation.error', 1, {
        operation: context.operation,
        attempt,
        error: error.name,
      });

      if (attempt === maxAttempts) break;

      // Calculate exponential backoff with jitter
      const delay = Math.min(
        Math.floor(baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000),
        maxDelay
      );

      logger.warn(
        `AI operation failed on attempt ${attempt}. Retrying after ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new OpenAIError(
    `Operation failed after ${maxAttempts} attempts: ${lastError.message}`,
    { cause: lastError, context }
  );
};

/**
 * Generates an enhanced completion using OpenAI's API with fallback and error handling.
 *
 * @param {Array<Object>} messages - The chat messages for context.
 * @param {Object} options - Options for the completion.
 * @returns {Promise<string>} The AI-generated text.
 * @throws {Error} If the operation fails.
 */
const createEnhancedCompletion = async (messages, options = {}) => {
  const {
    userId,
    model = AI_CONFIG.MODELS.DEFAULT,
    temperature = 0.7,
    maxTokens = 150,
    context = {},
  } = options;

  // Rate limiting check
  await rateLimiter.checkLimit(userId);

  const operation = async (usesFallback = false) => {
    try {
      const startTime = Date.now();

      const response = await circuitBreaker.execute(async () => {
        return await openai.createChatCompletion({
          model: usesFallback ? AI_CONFIG.MODELS.FALLBACK : model,
          messages,
          temperature,
          max_tokens: maxTokens,
          presence_penalty: 0.6,
          frequency_penalty: 0.5,
        });
      }, context);

      metrics.timing('ai.completion.duration', Date.now() - startTime, {
        model: usesFallback ? 'fallback' : 'primary',
        operation: context.operation,
      });

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      if (!usesFallback && error.response?.status === 429) {
        logger.warn('Primary model rate limited, attempting fallback');
        return operation(true);
      }
      throw error;
    }
  };

  return retryWithBackoff(operation, {
    context: { ...context, operation: 'createCompletion' },
  });
};

/**
 * Validates and sanitizes AI input.
 *
 * @param {string} text - The input text.
 * @param {Object} [options={}] - Validation options.
 * @returns {string} Sanitized text.
 * @throws {AppError} If validation fails.
 */
const validateAIInput = (text, options = {}) => {
  const {
    minLength = AI_CONFIG.ANALYSIS.MIN_TEXT_LENGTH,
    maxLength = AI_CONFIG.ANALYSIS.MAX_TEXT_LENGTH,
    required = true,
  } = options;

  if (!text && required) {
    throw new AppError(AI_CONFIG.ERROR_MESSAGES.VALIDATION, 400);
  }

  if (text) {
    const sanitized = sanitizeInput(text.trim());
    if (sanitized.length < minLength || sanitized.length > maxLength) {
      throw new AppError(
        `Text must be between ${minLength} and ${maxLength} characters`,
        400
      );
    }
    return sanitized;
  }

  return text;
};

/**
 * Generates AI-powered testimonial improvement suggestions.
 *
 * @param {string} testimonialText - The original testimonial text.
 * @returns {Promise<Object>} AI-generated suggestions.
 */
export const generateEnhancedSuggestions = async (testimonialText) => {
  const cacheKey = cacheManager.generateKey('suggestions', testimonialText);
  const cached = await cacheManager.get(cacheKey);
  if (cached) return cached;

  const sanitizedText = validateAIInput(testimonialText);

  try {
    const messages = [
      {
        role: 'system',
        content: `Generate advanced testimonial improvements:
          - Style and tone enhancement
          - Structural improvements
          - Content gap analysis
          - Professional language suggestions
          - Impact statement recommendations
          - Industry-specific enhancements
          Return as detailed JSON object.`,
      },
      {
        role: 'user',
        content: `Enhance testimonial: "${sanitizedText}"`,
      },
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.6,
      maxTokens: 500,
      userId: 'system', // Replace with actual user ID if available
      context: { operation: 'generateSuggestions' },
    });

    const parsedResult = JSON.parse(result);
    await cacheManager.set(cacheKey, parsedResult);
    return parsedResult;
  } catch (error) {
    logger.error('Suggestion generation failed:', error);
    metrics.increment('ai.suggestions.generation.error');
    throw new AppError('Failed to generate suggestions', 500);
  }
};

/**
 * Detects potential issues or red flags in testimonial content.
 *
 * @param {string} testimonialText - The testimonial text to analyze.
 * @returns {Promise<Object>} Detected issues with confidence scores and explanations.
 */
export const detectContentIssues = async (testimonialText) => {
  const sanitizedText = validateAIInput(testimonialText);

  try {
    const messages = [
      {
        role: 'system',
        content: `Analyze the testimonial for potential issues:
          - Inappropriate content
          - Discriminatory language
          - Confidentiality breaches
          - Factual inconsistencies
          - Potential legal issues
          Return as JSON with confidence scores and explanations.`,
      },
      {
        role: 'user',
        content: `Check for issues in: "${sanitizedText}"`,
      },
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.2,
      userId: 'system', // Replace with actual user ID if available
      context: { operation: 'detectIssues' },
    });

    return JSON.parse(result);
  } catch (error) {
    logger.error('Content issue detection failed:', error);
    metrics.increment('ai.contentIssues.detection.error');
    throw new AppError('Failed to analyze content issues', 500);
  }
};

/**
 * Generates AI-powered testimonial suggestions with customization options.
 *
 * @param {string} testimonialText - The original testimonial text.
 * @param {Object} [options={}] - Customization options.
 * @returns {Promise<Object>} AI-generated suggestions.
 */
export const generateTestimonialImprovements = async (
  testimonialText,
  options = {}
) => {
  const cacheKey = cacheManager.generateKey('improvements', testimonialText);
  const cached = await cacheManager.get(cacheKey);
  if (cached) return cached;

  const sanitizedText = validateAIInput(testimonialText);

  try {
    const messages = [
      {
        role: 'system',
        content: `Analyze the testimonial and provide specific improvements:
          - Language and tone enhancements
          - Structure and flow suggestions
          - Impact statement recommendations
          - Professional terminology suggestions
          - Credibility boosters
          Return as detailed JSON with specific examples.`,
      },
      {
        role: 'user',
        content: `Suggest improvements for: "${sanitizedText}"`,
      },
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.7,
      maxTokens: 700,
      userId: 'system', // Replace with actual user ID if available
      context: { operation: 'generateImprovements' },
    });

    const parsedResult = JSON.parse(result);
    await cacheManager.set(cacheKey, parsedResult);
    return parsedResult;
  } catch (error) {
    logger.error('Improvement generation failed:', error);
    metrics.increment('ai.improvements.generation.error');
    throw new AppError('Failed to generate improvements', 500);
  }
};

/**
 * Processes a single testimonial text to extract skills, perform sentiment and emotion analysis.
 *
 * @param {string} testimonialText - The testimonial text to process.
 * @returns {Promise<Object>} Processed testimonial analytics.
 */
export const processTestimonialText = async (testimonialText) => {
  try {
    const sanitizedText = validateAIInput(testimonialText);
    const cacheKey = cacheManager.generateKey('testimonial_analysis', sanitizedText);

    const cachedData = await cacheManager.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const [skills, sentiment, emotions] = await Promise.all([
      extractSkillsFromText(sanitizedText),
      analyzeDetailedSentiment(sanitizedText),
      analyzeEmotions(sanitizedText),
    ]);

    const analytics = {
      skills,
      sentiment,
      emotions,
      meta: {
        wordCount: testimonialText.split(/\s+/).length,
        analyzedAt: new Date(),
        version: '2.0',
      },
    };

    await cacheManager.set(cacheKey, analytics);
    return analytics;
  } catch (error) {
    logger.error('Testimonial processing failed:', error);
    throw new AppError('Failed to process testimonial', 500);
  }
};

/**
 * Extracts skills from testimonial text using AI.
 *
 * @param {string} text - The text to analyze.
 * @returns {Promise<Object>} Extracted skills categorized.
 */
const extractSkillsFromText = async (text) => {
  try {
    const messages = [
      {
        role: 'system',
        content: `Extract and categorize skills from testimonials with these rules:
          - Separate technical and soft skills
          - Include confidence scores (0-1)
          - Identify skill levels (beginner, intermediate, expert)
          - Consider industry context
          - Filter out low-confidence skills
          Return a structured JSON object.`,
      },
      {
        role: 'user',
        content: `Analyze skills in: "${text}"`,
      },
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.3,
      userId: 'system', // Replace with actual user ID if available
      context: { operation: 'extractSkills' },
    });

    const parsed = JSON.parse(result);

    // Filter low confidence skills
    return {
      technical_skills: parsed.technical_skills.filter(
        (skill) => skill.confidence >= AI_CONFIG.ANALYSIS.SKILL_THRESHOLD
      ),
      soft_skills: parsed.soft_skills.filter(
        (skill) => skill.confidence >= AI_CONFIG.ANALYSIS.SKILL_THRESHOLD
      ),
    };
  } catch (error) {
    logger.error('Skill extraction failed:', error);
    metrics.increment('ai.skills.extraction.error');
    return { technical_skills: [], soft_skills: [] };
  }
};

/**
 * Performs detailed sentiment analysis on testimonial text.
 *
 * @param {string} text - The text to analyze.
 * @returns {Promise<Object>} Sentiment analysis results.
 */
export const analyzeDetailedSentiment = async (text) => {
  const sanitizedText = validateAIInput(text);

  const cacheKey = cacheManager.generateKey('sentiment_analysis', sanitizedText);
  const cached = await cacheManager.get(cacheKey);
  if (cached) return cached;

  try {
    const messages = [
      {
        role: 'system',
        content: `Perform detailed sentiment analysis with:
          - Overall sentiment score (-1 to 1)
          - Aspect-based sentiment for different components
          - Confidence scoring for each aspect
          - Tone and context analysis
          - Key phrase extraction
          Return a comprehensive JSON object.`,
      },
      {
        role: 'user',
        content: `Analyze sentiment in: "${sanitizedText}"`,
      },
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.2,
      userId: 'system', // Replace with actual user ID if available
      context: { operation: 'analyzeSentiment' },
    });

    const sentimentAnalysis = JSON.parse(result);
    await cacheManager.set(cacheKey, sentimentAnalysis);
    return sentimentAnalysis;
  } catch (error) {
    logger.error('Sentiment analysis failed:', error);
    metrics.increment('ai.sentiment.analysis.error');
    return { score: 0, aspects: {}, status: 'failed' };
  }
};

/**
 * Performs emotion analysis on testimonial text.
 *
 * @param {string} text - The text to analyze.
 * @returns {Promise<Object>} Emotion analysis results.
 */
export const analyzeEmotions = async (text) => {
  const sanitizedText = validateAIInput(text);

  const cacheKey = cacheManager.generateKey('emotion_analysis', sanitizedText);
  const cached = await cacheManager.get(cacheKey);
  if (cached) return cached;

  try {
    const messages = [
      {
        role: 'system',
        content: `Analyze emotions with:
          - Primary emotions
          - Secondary emotions
          - Intensity (0-1)
          - Context markers
          Return as JSON object.`,
      },
      {
        role: 'user',
        content: `Analyze emotions in: "${sanitizedText}"`,
      },
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.4,
      userId: 'system', // Replace with actual user ID if available
      context: { operation: 'analyzeEmotions' },
    });

    const emotionAnalysis = JSON.parse(result);
    await cacheManager.set(cacheKey, emotionAnalysis);
    return emotionAnalysis;
  } catch (error) {
    logger.error('Emotion analysis failed:', error);
    metrics.increment('ai.emotion.analysis.error');
    return {};
  }
};

/**
 * Generates AI-powered testimonial suggestions based on project details and skills.
 *
 * @param {string} projectDetails - Details about the project.
 * @param {Array<string>} skills - List of skills to highlight.
 * @returns {Promise<string>} AI-generated testimonial suggestion.
 */
export const generateAITestimonialSuggestion = async (
  projectDetails,
  skills = []
) => {
  try {
    const prompt = `
      You are an AI assistant that helps users generate professional testimonials based on project details and skills.

      Project Details:
      "${projectDetails}"

      Skills:
      ${skills.join(', ')}

      Provide a well-structured testimonial that highlights the user's expertise and the success of the project.
    `;

    const response = await openai.createCompletion({
      model: 'text-davinci-003',
      prompt,
      max_tokens: 150,
      temperature: 0.7,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    const suggestion = response.data.choices[0].text.trim();
    return suggestion;
  } catch (error) {
    handleOpenAIError(error);
  }
};

/**
 * Handles OpenAI Errors by categorizing and logging them appropriately.
 *
 * @param {Error} error - The error object thrown by OpenAI methods.
 * @throws {Error} Re-throws categorized errors.
 */
function handleOpenAIError(error) {
  if (error.response) {
    // OpenAI API returned an error response
    if (error.response.status === 429) {
      logger.error('❌ Rate limit exceeded. Please try again later.');
      throw new AppError('Rate limit exceeded. Please try again later.', 429);
    } else if (
      error.response.data &&
      error.response.data.error &&
      error.response.data.error.code === 'insufficient_quota'
    ) {
      logger.error('❌ Quota exceeded. Please upgrade your OpenAI plan.');
      throw new AppError('Quota exceeded. Please upgrade your OpenAI plan.', 403);
    } else {
      logger.error(
        `❌ OpenAI API Error: ${error.response.status} - ${
          error.response.data.error.message || error.message
        }`
      );
      throw new AppError(
        `OpenAI API Error: ${error.response.data.error.message || error.message}`,
        error.response.status
      );
    }
  } else if (error.request) {
    // No response received from OpenAI API
    logger.error(`❌ No response from OpenAI API: ${error.message}`);
    throw new AppError('No response from AI service. Please try again later.', 503);
  } else {
    // Other errors
    logger.error(`❌ OpenAI Service Error: ${error.message}`);
    throw new AppError('Failed to process request using AI service.', 500);
  }
}

/**
 * Generates a comprehensive AI testimonial.
 *
 * @param {Object} options - Configuration options for testimonial generation.
 * @returns {Promise<Object>} Generated testimonial and metadata.
 */
export const generateAITestimonial = async (options = {}) => {
  const {
    projectDetails,
    seekerProfile,
    giverProfile,
    tone = TESTIMONIAL_CONFIG.TONES.PROFESSIONAL,
    length = TESTIMONIAL_CONFIG.LENGTHS.MEDIUM,
    focusAreas = [
      TESTIMONIAL_CONFIG.FOCUS_AREAS.SKILLS,
      TESTIMONIAL_CONFIG.FOCUS_AREAS.IMPACT,
    ],
    industry,
    relationship,
    duration,
    achievements = [],
    keywords = [],
    style = {},
    userId,
  } = options;

  // Validate inputs
  if (!projectDetails || !seekerProfile) {
    throw new AppError('Project details and seeker profile are required.', 400);
  }

  // Generate cache key based on input parameters
  const cacheKey = cacheManager.generateKey('testimonial_gen', {
    projectDetails,
    seekerProfile,
    tone,
    length,
    focusAreas,
    industry,
  });

  try {
    return await cacheManager.getOrCompute(
      cacheKey,
      async () => {
        // Construct context-aware prompt
        const contextPrompt = constructTestimonialPrompt({
          projectDetails,
          seekerProfile,
          giverProfile,
          tone,
          length,
          focusAreas,
          industry,
          relationship,
          duration,
          achievements,
          keywords,
          style,
        });

        const messages = [
          {
            role: 'system',
            content: `You are an expert testimonial writer with a deep understanding of ${
              industry || 'various industries'
            }. Generate authentic, impactful testimonials that highlight real value and specific contributions.`,
          },
          {
            role: 'user',
            content: contextPrompt,
          },
        ];

        // Generate initial testimonial
        const rawTestimonial = await createEnhancedCompletion(messages, {
          temperature: 0.7,
          maxTokens: length.max * 2,
          userId,
          context: { operation: 'generateTestimonial' },
        });

        // Parse and enhance the generated testimonial
        const enhancedTestimonial = await enhanceTestimonialContent(
          rawTestimonial,
          {
            tone,
            focusAreas,
            industry,
            keywords,
          }
        );

        // Analyze sentiment and authenticity
        const [sentiment, authenticity] = await Promise.all([
          analyzeDetailedSentiment(enhancedTestimonial.enhanced),
          analyzeTestimonialAuthenticity(enhancedTestimonial.enhanced),
        ]);

        // Generate alternative versions with different tones
        const alternatives = await generateAlternativeVersions(
          enhancedTestimonial.enhanced,
          {
            tones: [
              TESTIMONIAL_CONFIG.TONES.CASUAL,
              TESTIMONIAL_CONFIG.TONES.ENTHUSIASTIC,
            ],
            length,
          }
        );

        // Compile final response
        const result = {
          original: enhancedTestimonial.content,
          enhanced: enhancedTestimonial.enhanced,
          alternatives,
          metadata: {
            sentiment,
            authenticity,
            stats: {
              wordCount: enhancedTestimonial.content.split(/\s+/).length,
              readabilityScore: calculateReadabilityScore(
                enhancedTestimonial.content
              ),
              impactScore: calculateImpactScore(enhancedTestimonial),
            },
            keywords: extractKeyPhrases(enhancedTestimonial.content),
            focusAreas: analyzeContentFocus(
              enhancedTestimonial.content,
              focusAreas
            ),
            suggestions: enhancedTestimonial.suggestions,
          },
          generatedAt: new Date().toISOString(),
        };

        // Track metrics
        metrics.timing('ai.testimonial.generation', Date.now(), {
          industry,
          tone,
          length: Object.keys(TESTIMONIAL_CONFIG.LENGTHS).find(
            (key) => TESTIMONIAL_CONFIG.LENGTHS[key] === length
          ),
        });

        return result;
      },
      AI_CONFIG.CACHE.TTL
    );
  } catch (error) {
    logger.error('Testimonial generation failed:', error);
    metrics.increment('ai.testimonial.generation.error');
    throw new AppError('Failed to generate testimonial', 500);
  }
};

/**
 * Constructs a detailed prompt for testimonial generation.
 *
 * @param {Object} params - Parameters for the prompt.
 * @returns {string} The constructed prompt.
 */
const constructTestimonialPrompt = (params) => {
  const {
    projectDetails,
    seekerProfile,
    giverProfile,
    tone,
    length,
    focusAreas,
    industry,
    relationship,
    duration,
    achievements,
    keywords,
    style,
  } = params;

  return `
    Context:
    - Industry: ${industry || 'Not specified'}
    - Relationship: ${relationship || 'Professional collaboration'}
    - Duration: ${duration || 'Project-based'}
    - Professional Context: ${projectDetails}

    Profile Information:
    - Seeker Background: ${seekerProfile}
    ${giverProfile ? `- Giver Perspective: ${giverProfile}` : ''}

    Key Achievements:
    ${achievements.map((achievement) => `- ${achievement}`).join('\n')}

    Requirements:
    - Tone: ${tone}
    - Length: ${length.min}-${length.max} words
    - Focus Areas: ${focusAreas.join(', ')}
    ${keywords.length ? `- Key Terms: ${keywords.join(', ')}` : ''}
    ${style.emphasis ? `- Emphasis: ${style.emphasis}` : ''}

    Generate a testimonial that:
    1. Demonstrates authentic experience and specific value
    2. Includes concrete examples and measurable impacts
    3. Maintains professional credibility while being engaging
    4. Balances technical expertise with soft skills
    5. Follows industry-standard terminology
    6. Creates a compelling narrative arc
  `;
};

/**
 * Enhances testimonial content based on customization options.
 *
 * @param {string} content - The original testimonial content.
 * @param {Object} options - Customization options.
 * @returns {Promise<Object>} Enhanced testimonial content and suggestions.
 */
const enhanceTestimonialContent = async (content, options) => {
  const { tone, focusAreas, industry, keywords } = options;

  try {
    const messages = [
      {
        role: 'system',
        content: `Enhance this testimonial while maintaining authenticity:
          - Adjust tone to be ${tone}
          - Focus on these areas: ${focusAreas.join(', ')}
          - Use appropriate ${industry || 'professional'} terminology
          - Incorporate relevant keywords: ${keywords.join(', ')}
          Return a JSON object with enhanced content and suggestions.`,
      },
      {
        role: 'user',
        content: `Enhance: "${content}"`,
      },
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.6,
      maxTokens: 500,
      userId: 'system', // Replace with actual user ID if available
      context: { operation: 'enhanceContent' },
    });

    const enhanced = JSON.parse(result);

    return {
      content: content,
      enhanced: enhanced.content,
      suggestions: enhanced.suggestions || [],
      improvements: enhanced.improvements || [],
    };
  } catch (error) {
    logger.error('Content enhancement failed:', error);
    return { content, enhanced: content, suggestions: [], improvements: [] };
  }
};

/**
 * Analyzes the authenticity of a testimonial.
 *
 * @param {string} content - The testimonial content.
 * @returns {Promise<Object>} Authenticity analysis results.
 */
const analyzeTestimonialAuthenticity = async (content) => {
  try {
    const messages = [
      {
        role: 'system',
        content: `Analyze testimonial authenticity based on:
          - Language naturality
          - Specific details presence
          - Personal voice consistency
          - Credibility markers
          - Emotional resonance
          Return a detailed JSON analysis with scores and explanations.`,
      },
      {
        role: 'user',
        content: `Analyze authenticity: "${content}"`,
      },
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.3,
      maxTokens: 300,
      userId: 'system', // Replace with actual user ID if available
      context: { operation: 'analyzeAuthenticity' },
    });

    const analysis = JSON.parse(result);

    return {
      score: analysis.overall_score || 0,
      aspects: analysis.aspect_scores || {},
      markers: analysis.authenticity_markers || [],
      suggestions: analysis.improvement_suggestions || [],
    };
  } catch (error) {
    logger.error('Authenticity analysis failed:', error);
    metrics.increment('ai.authenticity.analysis.error');
    return { score: 0.5, aspects: {}, markers: [], suggestions: [] };
  }
};

/**
 * Generates alternative versions of a testimonial with different tones.
 *
 * @param {string} content - The original testimonial content.
 * @param {Object} options - Options for generating alternatives.
 * @returns {Promise<Array>} Array of alternative testimonial versions.
 */
const generateAlternativeVersions = async (content, options) => {
  const { tones, length } = options;

  try {
    const alternatives = await Promise.all(
      tones.map(async (tone) => {
        const messages = [
          {
            role: 'system',
            content: `Rewrite this testimonial in a ${tone} tone while:
              - Maintaining core message and facts
              - Adjusting language and style
              - Keeping length between ${length.min}-${length.max} words
              - Preserving professional credibility
              Return the rewritten version with tone markers.`,
          },
          {
            role: 'user',
            content: `Rewrite: "${content}"`,
          },
        ];

        const result = await createEnhancedCompletion(messages, {
          temperature: 0.7,
          maxTokens: length.max * 2,
          userId: 'system', // Replace with actual user ID if available
          context: { operation: 'generateAlternative' },
        });

        return {
          tone,
          content: result,
          wordCount: result.split(/\s+/).length,
          timestamp: new Date().toISOString(),
        };
      })
    );

    return alternatives.filter(
      (alt) => alt.wordCount >= length.min && alt.wordCount <= length.max
    );
  } catch (error) {
    logger.error('Alternative generation failed:', error);
    metrics.increment('ai.alternative.generation.error');
    return [];
  }
};

/**
 * Calculates the impact score based on various factors.
 *
 * @param {Object} testimonial - The testimonial object with analytics.
 * @returns {number} Impact score between 0 and 1.
 */
const calculateImpactScore = (testimonial) => {
  const impactFactors = {
    specificity: hasSpecificDetails(testimonial.content),
    metrics: hasQuantitativeMetrics(testimonial.content),
    clarity: testimonial.metadata.stats.readabilityScore / 100,
    sentiment: testimonial.metadata.sentiment.score,
    authenticity: testimonial.metadata.authenticity.score,
  };

  return (
    Object.values(impactFactors).reduce((acc, val) => acc + val, 0) /
    Object.keys(impactFactors).length
  );
};

/**
 * Calculates the readability score using the Flesch-Kincaid formula.
 *
 * @param {string} text - The text to analyze.
 * @returns {number} Readability score between 0 and 100.
 */
const calculateReadabilityScore = (text) => {
  const words = text.split(/\s+/).length;
  const sentences = text.split(/[.!?]+/).length;
  const syllables = countSyllables(text);

  // Flesch-Kincaid Grade Level
  const score = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;

  return Math.max(0, Math.min(100, Math.round(100 - score)));
};

/**
 * Counts the number of syllables in a text.
 *
 * @param {string} text - The text to analyze.
 * @returns {number} Number of syllables.
 */
const countSyllables = (text) => {
  text = text.toLowerCase();
  if (text.length <= 3) return 1;
  text = text.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  text = text.replace(/^y/, '');
  const syllables = text.match(/[aeiouy]{1,2}/g);
  return syllables ? syllables.length : 1;
};

/**
 * Checks if the testimonial has specific details.
 *
 * @param {string} content - The testimonial content.
 * @returns {number} 1 if specific details are present, 0 otherwise.
 */
const hasSpecificDetails = (content) => {
  // Simple heuristic: presence of numbers or specific project details
  return /\d/.test(content) ? 1 : 0;
};

/**
 * Checks if the testimonial contains quantitative metrics.
 *
 * @param {string} content - The testimonial content.
 * @returns {number} 1 if metrics are present, 0 otherwise.
 */
const hasQuantitativeMetrics = (content) => {
  // Simple heuristic: presence of percentages, dollar amounts, etc.
  return /(\d+%|\$\d+)/.test(content) ? 1 : 0;
};

/**
 * Extracts key phrases from the testimonial content.
 *
 * @param {string} text - The testimonial content.
 * @returns {Array<string>} Array of key phrases.
 */
const extractKeyPhrases = (text) => {
  // Simple implementation - can be enhanced with NLP libraries
  const words = text.toLowerCase().split(/\W+/);
  const phrases = [];

  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].length > 3 && words[i + 1].length > 3) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
    }
  }

  return [...new Set(phrases)];
};

/**
 * Analyzes the content focus areas within the testimonial.
 *
 * @param {string} content - The testimonial content.
 * @param {Array<string>} targetAreas - The focus areas to analyze.
 * @returns {Object} Analysis of content focus.
 */
const analyzeContentFocus = (content, targetAreas) => {
  const analysis = {};

  for (const area of targetAreas) {
    analysis[area] = {
      coverage: calculateAreaCoverage(content, area),
      keywords: extractAreaKeywords(content, area),
      suggestions: generateAreaSuggestions(content, area),
    };
  }

  return analysis;
};

/**
 * Calculates area coverage - simple binary for now.
 *
 * @param {string} content - The testimonial content.
 * @param {string} area - The focus area.
 * @returns {number} 1 or 0.
 */
const calculateAreaCoverage = (content, area) => {
  const regex = new RegExp(area, 'i');
  return regex.test(content) ? 1 : 0;
};

/**
 * Extracts area-specific keywords - placeholder.
 *
 * @param {string} content
 * @param {string} area
 * @returns {Array<string>}
 */
const extractAreaKeywords = (content, area) => {
  // Implement actual keyword extraction logic as needed
  return [];
};

/**
 * Generates suggestions for a specific focus area.
 *
 * @param {string} content
 * @param {string} area
 * @returns {Array<string>}
 */
const generateAreaSuggestions = (content, area) => {
  // Implement actual suggestion logic as needed
  return [];
};

/**
 * Extracts skills from text using AI.
 *
 * @param {string} text - The text to analyze.
 * @returns {Promise<Object>} Extracted skills categorized.
 */
const extractSkills = async (text) => {
  try {
    const sanitizedText = validateAIInput(text);
    const cacheKey = cacheManager.generateKey('skill_extraction', sanitizedText);

    const cached = await cacheManager.get(cacheKey);
    if (cached) return cached;

    const messages = [
      {
        role: 'system',
        content: `Extract and categorize skills from the following testimonial:
          - Separate technical and soft skills
          - Include confidence scores (0-1)
          - Identify skill levels (beginner, intermediate, expert)
          - Consider industry context
          - Filter out low-confidence skills
          Return as a structured JSON object.`,
      },
      {
        role: 'user',
        content: `Analyze skills in: "${sanitizedText}"`,
      },
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.3,
      maxTokens: 300,
      userId: 'system', // Replace with actual user ID if available
      context: { operation: 'extractSkills' },
    });

    const parsed = JSON.parse(result);

    const skills = {
      technical_skills: parsed.technical_skills.filter(
        (skill) => skill.confidence >= AI_CONFIG.ANALYSIS.SKILL_THRESHOLD
      ),
      soft_skills: parsed.soft_skills.filter(
        (skill) => skill.confidence >= AI_CONFIG.ANALYSIS.SKILL_THRESHOLD
      ),
    };

    await cacheManager.set(cacheKey, skills);
    return skills;
  } catch (error) {
    logger.error('Skill extraction failed:', error);
    metrics.increment('ai.skills.extraction.error');
    return { technical_skills: [], soft_skills: [] };
  }
};

/**
 * Generates a response from OpenAI based on user input.
 *
 * @param {string} userMessage - The message from the user.
 * @returns {Promise<string>} The AI-generated response.
 */
export const handleChatQuery = async (userMessage) => {
  try {
    const sanitizedMessage = sanitizeInput(userMessage.trim());
    const cacheKey = cacheManager.generateKey('chat_response', sanitizedMessage);

    const cached = await cacheManager.get(cacheKey);
    if (cached) return cached;

    const messages = [
      {
        role: 'system',
        content: 'You are a helpful and knowledgeable assistant.',
      },
      {
        role: 'user',
        content: sanitizedMessage,
      },
    ];

    const response = await openai.createChatCompletion({
      model: 'gpt-4',
      messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    const aiResponse = response.data.choices[0].message.content.trim();
    await cacheManager.set(cacheKey, aiResponse, AI_CONFIG.CACHE.TTL);
    return aiResponse;
  } catch (error) {
    logger.error('❌ Chat Query Error:', error);
    metrics.increment('ai.chat.query.error');
    throw new AppError('Failed to process chat query', 500);
  }
};

/**
 * Batch processes multiple testimonials for analytics.
 *
 * @param {Array<string>} testimonials - Array of testimonial texts.
 * @returns {Promise<Array<Object>>} Array of processed analytics.
 */
export const batchProcessTestimonials = async (testimonials) => {
  const chunks = [];
  for (let i = 0; i < testimonials.length; i += AI_CONFIG.BATCH.SIZE) {
    chunks.push(testimonials.slice(i, i + AI_CONFIG.BATCH.SIZE));
  }

  const results = [];
  for (const chunk of chunks) {
    const chunkResults = await Promise.allSettled(
      chunk.map((testimonial) => processTestimonialText(testimonial))
    );

    results.push(
      ...chunkResults.map((result) =>
        result.status === 'fulfilled' ? result.value : null
      )
    );

    // Rate limiting protection
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return results;
};

/**
 * Generates AI-powered testimonial improvement suggestions.
 *
 * @param {string} testimonialText - The original testimonial text.
 * @returns {Promise<Object>} AI-generated suggestions.
 */
export const generateTestimonialSuggestions = async (testimonialText) => {
  const cacheKey = cacheManager.generateKey('suggestions', testimonialText);
  const cached = await cacheManager.get(cacheKey);
  if (cached) return cached;

  const sanitizedText = validateAIInput(testimonialText);

  try {
    const messages = [
      {
        role: 'system',
        content: `Generate advanced testimonial improvements:
          - Style and tone enhancement
          - Structural improvements
          - Content gap analysis
          - Professional language suggestions
          - Impact statement recommendations
          - Industry-specific enhancements
          Return as detailed JSON object.`,
      },
      {
        role: 'user',
        content: `Enhance testimonial: "${sanitizedText}"`,
      },
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.6,
      maxTokens: 700,
      userId: 'system', // Replace with actual user ID if available
      context: { operation: 'generateSuggestions' },
    });

    const parsedResult = JSON.parse(result);
    await cacheManager.set(cacheKey, parsedResult);
    return parsedResult;
  } catch (error) {
    logger.error('Suggestion generation failed:', error);
    metrics.increment('ai.suggestions.generation.error');
    throw new AppError('Failed to generate suggestions', 500);
  }
};

/**
 * Generates AI-powered recommendations based on analytics data.
 *
 * @param {Object} recommendationData - Data used to generate recommendations.
 * @returns {Promise<Array<string>>} Array of recommendations.
 */
export const generateRecommendations = async (recommendationData) => {
  try {
    const prompt = `
      Based on the following user analytics data, provide actionable recommendations to improve their testimonial quality and impact:

      ${JSON.stringify(recommendationData, null, 2)}

      Recommendations:
    `;

    const response = await openai.createCompletion({
      model: 'text-davinci-003',
      prompt,
      max_tokens: 300,
      temperature: 0.5,
      top_p: 1,
      frequency_penalty: 0.3,
      presence_penalty: 0.3,
    });

    const recommendations = response.data.choices[0].text
      .split('\n')
      .map((rec) => rec.trim())
      .filter((rec) => rec.length > 0);

    return recommendations;
  } catch (error) {
    logger.error('Recommendations generation failed:', error);
    metrics.increment('ai.recommendations.generation.error');
    return [];
  }
};

/**
 * Handles OpenAI Errors by categorizing and logging them appropriately.
 *
 * @param {Error} error - The error object thrown by OpenAI methods.
 * @throws {Error} Re-throws categorized errors.
 */
function handleOpenAIError(error) {
  if (error.response) {
    // OpenAI API returned an error response
    if (error.response.status === 429) {
      logger.error('❌ Rate limit exceeded. Please try again later.');
      throw new AppError('Rate limit exceeded. Please try again later.', 429);
    } else if (
      error.response.data &&
      error.response.data.error &&
      error.response.data.error.code === 'insufficient_quota'
    ) {
      logger.error('❌ Quota exceeded. Please upgrade your OpenAI plan.');
      throw new AppError('Quota exceeded. Please upgrade your OpenAI plan.', 403);
    } else {
      logger.error(
        `❌ OpenAI API Error: ${error.response.status} - ${
          error.response.data.error.message || error.message
        }`
      );
      throw new AppError(
        `OpenAI API Error: ${error.response.data.error.message || error.message}`,
        error.response.status
      );
    }
  } else if (error.request) {
    // No response received from OpenAI API
    logger.error(`❌ No response from OpenAI API: ${error.message}`);
    throw new AppError('No response from AI service. Please try again later.', 503);
  } else {
    // Other errors
    logger.error(`❌ OpenAI Service Error: ${error.message}`);
    throw new AppError('Failed to process request using AI service.', 500);
  }
}

/**
 * Generates a comprehensive AI testimonial with advanced customization options.
 * This method is an advanced version of the generateAITestimonial method.
 * @param {Object} options - Configuration options for testimonial generation.
 * @returns {Promise<Object>} Generated testimonial and metadata.
 */

export const generateAITestimonialAdvanced = async (options = {}) => {
  const {
    projectDetails,
    seekerProfile,
    giverProfile,
    tone = TESTIMONIAL_CONFIG.TONES.PROFESSIONAL,
    length = TESTIMONIAL_CONFIG.LENGTHS.MEDIUM,
    focusAreas = [
      TESTIMONIAL_CONFIG.FOCUS_AREAS.SKILLS,
      TESTIMONIAL_CONFIG.FOCUS_AREAS.IMPACT,
    ],
    industry,
    relationship,
    duration,
    achievements = [],
    keywords = [],
    style = {},
    userId,
  } = options;

  // Validate inputs
  if (!projectDetails || !seekerProfile) {
    throw new AppError('Project details and seeker profile are required.', 400);
  }

  // Generate cache key based on input parameters
  const cacheKey = cacheManager.generateKey('testimonial_gen_advanced', {
    projectDetails,
    seekerProfile,
    tone,
    length,
    focusAreas,
    industry,
    relationship,
    duration,
    achievements,
    keywords,
    style,
  });

  try {
    return await cacheManager.getOrCompute(
      cacheKey,
      async () => {
        // Construct context-aware prompt
        const contextPrompt = constructTestimonialPrompt({
          projectDetails,
          seekerProfile,
          giverProfile,
          tone,
          length,
          focusAreas,
          industry,
          relationship,
          duration,
          achievements,
          keywords,
          style,
        });

        const messages = [
          {
            role: 'system',
            content: `You are an expert testimonial writer with a deep understanding of ${
              industry || 'various industries'
            }. Generate authentic, impactful testimonials that highlight real value and specific contributions.`,
          },
          {
            role: 'user',
            content: contextPrompt,
          },
        ];

        // Generate initial testimonial
        const rawTestimonial = await createEnhancedCompletion(messages, {
          temperature: 0.7,
          maxTokens: length.max * 2,
          userId,
          context: { operation: 'generateTestimonialAdvanced' },
        });

        // Parse and enhance the generated testimonial
        const enhancedTestimonial = await enhanceTestimonialContent(rawTestimonial, {
          tone,
          focusAreas,
          industry,
          keywords,
        });

        // Analyze sentiment and authenticity
        const [sentiment, authenticity] = await Promise.all([
          analyzeDetailedSentiment(enhancedTestimonial.enhanced),
          analyzeTestimonialAuthenticity(enhancedTestimonial.enhanced),
        ]);

        // Generate alternative versions with different tones
        const alternatives = await generateAlternativeVersions(enhancedTestimonial.enhanced, {
          tones: [
            TESTIMONIAL_CONFIG.TONES.CASUAL,
            TESTIMONIAL_CONFIG.TONES.ENTHUSIASTIC,
          ],
          length,
        });

        // Compile final response
        const result = {
          original: enhancedTestimonial.content,
          enhanced: enhancedTestimonial.enhanced,
          alternatives,
          metadata: {
            sentiment,
            authenticity,
            stats: {
              wordCount: enhancedTestimonial.content.split(/\s+/).length,
              readabilityScore: calculateReadabilityScore(enhancedTestimonial.content),
              impactScore: calculateImpactScore(enhancedTestimonial),
            },
            keywords: extractKeyPhrases(enhancedTestimonial.content),
            focusAreas: analyzeContentFocus(enhancedTestimonial.content, focusAreas),
            suggestions: enhancedTestimonial.suggestions,
          },
          generatedAt: new Date().toISOString(),
        };

        // Track metrics
        metrics.timing('ai.testimonial.generation.advanced', Date.now(), {
          industry,
          tone,
          length: Object.keys(TESTIMONIAL_CONFIG.LENGTHS).find(
            (key) => TESTIMONIAL_CONFIG.LENGTHS[key] === length
          ),
        });

        return result;
      },
      AI_CONFIG.CACHE.TTL
    );
  } catch (error) {
    logger.error('Advanced testimonial generation failed:', error);
    metrics.increment('ai.testimonial.generation.advanced.error');
    throw new AppError('Failed to generate advanced testimonial', 500);
  }
};


const aiService = {
  generateEnhancedSuggestions,
  detectContentIssues,
  generateTestimonialImprovements,
  processTestimonialText,
  extractSkillsFromText,
  analyzeDetailedSentiment,
  analyzeEmotions,
  handleChatQuery,
  batchProcessTestimonials,
  generateAITestimonial,
  generateAITestimonialAdvanced,
  generateRecommendations,
};

export default aiService;