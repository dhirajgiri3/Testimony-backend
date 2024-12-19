import { openai } from '../config/openAI.js';
import redis from '../config/redis.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
import { cacheManager } from '../middlewares/cache.js';
import { metrics } from '../utils/metrics.js';
import { OpenAIError } from '../utils/errors.js';
import { sanitizeInput } from '../utils/sanitizer.js';

// Enhanced AI Configuration with new features
const AI_CONFIG = {
  CACHE: {
    TTL: 24 * 60 * 60, // 24 hours
    PREFIX: 'ai_service',
    RETRY_TTL: 300 // 5 minutes for failed requests
  },
  RETRY: {
    MAX_ATTEMPTS: 3,
    BASE_DELAY: 1000,
    MAX_DELAY: 5000
  },
  TIMEOUT: {
    DEFAULT: 10000, // 10 seconds
    LONG: 20000 // 20 seconds for complex operations
  },
  BATCH: {
    SIZE: 5,
    CONCURRENT_LIMIT: 3
  },
  MODELS: {
    DEFAULT: 'gpt-4',
    FALLBACK: 'gpt-3.5-turbo'
  },
  ANALYSIS: {
    SKILL_THRESHOLD: 0.6,
    SENTIMENT_THRESHOLD: 0.7,
    MIN_TEXT_LENGTH: 20,
    MAX_TEXT_LENGTH: 5000
  },
  RATE_LIMITS: {
    REQUESTS_PER_MIN: 50,
    TOKENS_PER_MIN: 10000
  },
  ERROR_MESSAGES: {
    VALIDATION: 'Invalid input for AI processing',
    RATE_LIMIT: 'AI request rate limit exceeded',
    TIMEOUT: 'AI operation timed out',
    PROCESSING: 'Error processing AI request'
  }
};

/**
 * Rate limiter implementation
 */
class AIRateLimiter {
  constructor() {
    this.requests = new Map();
    this.tokens = new Map();
  }

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

    return true;
  }

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
 * Enhanced input validation
 */
const validateAIInput = (text, options = {}) => {
  const {
    minLength = AI_CONFIG.ANALYSIS.MIN_TEXT_LENGTH,
    maxLength = AI_CONFIG.ANALYSIS.MAX_TEXT_LENGTH,
    required = true
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

// Enhanced retry mechanism with circuit breaker
class CircuitBreaker {
  constructor() {
    this.failures = 0;
    this.lastFailure = null;
    this.state = 'CLOSED';
  }

  async execute(operation, context) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure < 30000) { // 30 seconds cooling
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

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= 5) { // 5 consecutive failures
      this.state = 'OPEN';
    }
  }

  reset() {
    this.failures = 0;
    this.lastFailure = null;
    this.state = 'CLOSED';
  }
}

const circuitBreaker = new CircuitBreaker();

/**
 * Enhanced retry mechanism with exponential backoff
 */
const retryWithBackoff = async (operation, options = {}) => {
  const {
    maxAttempts = AI_CONFIG.RETRY.MAX_ATTEMPTS,
    baseDelay = AI_CONFIG.RETRY.BASE_DELAY,
    maxDelay = AI_CONFIG.RETRY.MAX_DELAY,
    context = {}
  } = options;

  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const startTime = Date.now();
      const result = await Promise.race([
        operation(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), 
          options.timeout || AI_CONFIG.TIMEOUT.DEFAULT)
        )
      ]);

      // Track metrics
      metrics.timing('ai.operation.duration', Date.now() - startTime, {
        operation: context.operation,
        attempt,
        success: true
      });

      return result;

    } catch (error) {
      lastError = error;
      metrics.increment('ai.operation.error', 1, {
        operation: context.operation,
        attempt,
        error: error.name
      });

      if (attempt === maxAttempts) break;

      // Calculate exponential backoff with jitter
      const delay = Math.min(
        Math.floor(baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000),
        maxDelay
      );
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new OpenAIError(
    `Operation failed after ${maxAttempts} attempts: ${lastError.message}`,
    { cause: lastError, context }
  );
};

/**
 * Enhanced OpenAI API interaction with improved error handling and fallback
 */
async function createEnhancedCompletion(messages, options = {}) {
  const {
    userId,
    model = AI_CONFIG.MODELS.DEFAULT,
    temperature = 0.7,
    maxTokens = 150,
    context = {}
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
          frequency_penalty: 0.5
        });
      }, context);

      metrics.timing('ai.completion.duration', Date.now() - startTime, {
        model: usesFallback ? 'fallback' : 'primary',
        operation: context.operation
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
    context: { ...context, operation: 'createCompletion' }
  });
}

/**
 * Enhanced skill extraction with improved accuracy and validation
 */
export const extractSkills = async (testimonialText, options = {}) => {
  const sanitizedText = validateAIInput(testimonialText);
  if (!sanitizedText) return { technical_skills: [], soft_skills: [] };

  const cacheKey = cacheManager.generateKey('skills', sanitizedText);
  
  try {
    return await cacheManager.getOrCompute(
      cacheKey,
      async () => {
        const messages = [
          {
            role: "system",
            content: `Extract and categorize skills from testimonials with these rules:
              - Separate technical and soft skills
              - Include confidence scores (0-1)
              - Identify skill levels (beginner, intermediate, expert)
              - Consider industry context
              - Filter out low-confidence skills
              Return a structured JSON object.`
          },
          {
            role: "user",
            content: `Analyze skills in: "${sanitizedText}"`
          }
        ];

        const result = await createEnhancedCompletion(messages, {
          temperature: 0.3,
          userId: options.userId,
          context: { operation: 'extractSkills' }
        });

        const parsed = JSON.parse(result);
        
        // Filter low confidence skills
        return {
          technical_skills: parsed.technical_skills.filter(
            skill => skill.confidence >= AI_CONFIG.ANALYSIS.SKILL_THRESHOLD
          ),
          soft_skills: parsed.soft_skills.filter(
            skill => skill.confidence >= AI_CONFIG.ANALYSIS.SKILL_THRESHOLD
          )
        };
      },
      AI_CONFIG.CACHE.TTL
    );
  } catch (error) {
    logger.error('Skill extraction failed:', { error, testimonialText });
    metrics.increment('ai.skills.extraction.error');
    return { technical_skills: [], soft_skills: [] };
  }
};

/**
 * Enhanced sentiment analysis with aspect-based evaluation
 */
export const analyzeDetailedSentiment = async (testimonialText) => {
  if (!testimonialText?.trim()) {
    return { score: 0, aspects: {}, confidence: 0 };
  }

  const cacheKey = cacheManager.generateKey('sentiment', testimonialText);

  try {
    return await cacheManager.getOrCompute(
      cacheKey,
      async () => {
        const messages = [
          {
            role: "system",
            content: `Perform detailed sentiment analysis with:
              - Overall sentiment score (-1 to 1)
              - Aspect-based sentiment for different components
              - Confidence scoring for each aspect
              - Tone and context analysis
              - Key phrase extraction
              Return a comprehensive JSON object.`
          },
          {
            role: "user",
            content: `Analyze sentiment in: "${testimonialText}"`
          }
        ];

        const result = await createEnhancedCompletion(messages, {
          temperature: 0.2,
          context: { operation: 'analyzeSentiment' }
        });

        return JSON.parse(result);
      },
      AI_CONFIG.CACHE.TTL
    );
  } catch (error) {
    logger.error('Sentiment analysis failed:', { error, testimonialText });
    metrics.increment('ai.sentiment.analysis.error');
    return { score: 0, aspects: {}, confidence: 0 };
  }
};

/**
 * Enhanced emotion analysis with context
 */
export const analyzeEmotions = async (testimonialText) => {
  if (!testimonialText?.trim()) return {};

  const cacheKey = cacheManager.generateKey('emotions', testimonialText);
  const cached = await cacheManager.get(cacheKey);
  if (cached) return cached;

  const messages = [
    {
      role: "system",
      content: `Analyze emotions with:
                - Primary emotions
                - Secondary emotions
                - Intensity (0-1)
                - Context markers
                Return as JSON object.`
    },
    {
      role: "user",
      content: `Analyze emotions in: "${testimonialText}"`
    }
  ];

  try {
    const result = await createEnhancedCompletion(messages, { temperature: 0.4 });
    const emotions = JSON.parse(result);
    await cacheManager.set(cacheKey, emotions);
    return emotions;
  } catch (error) {
    logger.error('Emotion analysis failed:', error);
    return {};
  }
};

/**
 * Comprehensive testimonial analysis
 */
export const processTestimonialText = async (testimonialText) => {
  try {
    const [skills, sentiment, emotions] = await Promise.all([
      extractSkills(testimonialText),
      analyzeDetailedSentiment(testimonialText),
      analyzeEmotions(testimonialText)
    ]);

    return {
      skills,
      sentiment,
      emotions,
      meta: {
        wordCount: testimonialText.split(/\s+/).length,
        analyzedAt: new Date(),
        version: '2.0'
      }
    };
  } catch (error) {
    logger.error('Testimonial processing failed:', error);
    throw new AppError('Failed to process testimonial', 500);
  }
};

/**
 * Generate improved testimonial suggestions
 */
export const generateEnhancedSuggestions = async (testimonialText, options = {}) => {
  if (!testimonialText?.trim()) {
    throw new AppError('Testimonial text is required', 400);
  }

  const cacheKey = cacheManager.generateKey('suggestions', testimonialText);

  try {
    return await cacheManager.getOrCompute(
      cacheKey,
      async () => {
        const messages = [
          {
            role: "system",
            content: `Generate advanced testimonial improvements:
              - Style and tone enhancement
              - Structural improvements
              - Content gap analysis
              - Professional language suggestions
              - Impact statement recommendations
              - Industry-specific enhancements
              Return as detailed JSON object.`
          },
          {
            role: "user",
            content: `Enhance testimonial: "${testimonialText}"`
          }
        ];

        const result = await createEnhancedCompletion(messages, {
          temperature: 0.6,
          maxTokens: 300,
          context: { operation: 'generateSuggestions' }
        });

        return JSON.parse(result);
      },
      AI_CONFIG.CACHE.TTL
    );
  } catch (error) {
    logger.error('Suggestion generation failed:', { error, testimonialText });
    metrics.increment('ai.suggestions.generation.error');
    throw new AppError('Failed to generate suggestions', 500);
  }
};

/**
 * Batch process multiple testimonials efficiently
 */
export const batchProcessTestimonials = async (testimonials, options = {}) => {
  const chunks = [];
  for (let i = 0; i < testimonials.length; i += AI_CONFIG.BATCH.SIZE) {
    chunks.push(testimonials.slice(i, i + AI_CONFIG.BATCH.SIZE));
  }

  const results = [];
  for (const chunk of chunks) {
    const chunkResults = await Promise.allSettled(
      chunk.map(testimonial => 
        processTestimonialText(testimonial.text, options)
      )
    );
    
    results.push(...chunkResults.map(result => 
      result.status === 'fulfilled' ? result.value : null
    ));

    // Rate limiting protection
    await new Promise(resolve => 
      setTimeout(resolve, 1000)
    );
  }

  return results;
};

/**
 * New method: Generate AI-powered testimonial improvement suggestions
 */
export const generateTestimonialImprovements = async (testimonialText, options = {}) => {
  const sanitizedText = validateAIInput(testimonialText);
  const cacheKey = cacheManager.generateKey('improvements', sanitizedText);

  try {
    return await cacheManager.getOrCompute(
      cacheKey,
      async () => {
        const messages = [
          {
            role: "system",
            content: `Analyze the testimonial and provide specific improvements:
              - Language and tone enhancements
              - Structure and flow suggestions
              - Impact statement recommendations
              - Professional terminology suggestions
              - Credibility boosters
              Return as detailed JSON with specific examples.`
          },
          {
            role: "user",
            content: `Suggest improvements for: "${sanitizedText}"`
          }
        ];

        const result = await createEnhancedCompletion(messages, {
          temperature: 0.7,
          maxTokens: 500,
          userId: options.userId,
          context: { operation: 'generateImprovements' }
        });

        return JSON.parse(result);
      },
      AI_CONFIG.CACHE.TTL
    );
  } catch (error) {
    logger.error('Improvement generation failed:', error);
    throw new AppError('Failed to generate improvements', 500);
  }
};

/**
 * New method: Detect potential red flags or inappropriate content
 */
export const detectContentIssues = async (testimonialText, options = {}) => {
  const sanitizedText = validateAIInput(testimonialText);
  
  try {
    const messages = [
      {
        role: "system",
        content: `Analyze the testimonial for potential issues:
          - Inappropriate content
          - Discriminatory language
          - Confidentiality breaches
          - Factual inconsistencies
          - Potential legal issues
          Return as JSON with confidence scores and explanations.`
      },
      {
        role: "user",
        content: `Check for issues in: "${sanitizedText}"`
      }
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.2,
      userId: options.userId,
      context: { operation: 'detectIssues' }
    });

    return JSON.parse(result);
  } catch (error) {
    logger.error('Content issue detection failed:', error);
    throw new AppError('Failed to analyze content issues', 500);
  }
};

// Export enhanced service
export default {
  extractSkills,
  analyzeDetailedSentiment,
  analyzeEmotions,
  processTestimonialText,
  generateEnhancedSuggestions,
  batchProcessTestimonials,
  generateTestimonialImprovements,
  detectContentIssues,
  AI_CONFIG
};