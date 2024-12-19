import { openai } from '../config/openAI.js';
import {redis} from '../config/redis.js';
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

// Add new configuration section for testimonial generation
const TESTIMONIAL_CONFIG = {
  TONES: {
    PROFESSIONAL: 'professional',
    CASUAL: 'casual',
    ENTHUSIASTIC: 'enthusiastic',
    BALANCED: 'balanced'
  },
  LENGTHS: {
    SHORT: { min: 50, max: 150 },
    MEDIUM: { min: 150, max: 300 },
    LONG: { min: 300, max: 500 }
  },
  FOCUS_AREAS: {
    SKILLS: 'skills',
    IMPACT: 'impact',
    COLLABORATION: 'collaboration',
    LEADERSHIP: 'leadership',
    TECHNICAL: 'technical',
    SOFT_SKILLS: 'soft_skills'
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

export const generateTestimonialSuggestions = async (testimonialText) => {
  const cacheKey = cacheManager.generateKey('suggestions', testimonialText);
  const cached = await cacheManager.get(cacheKey);
  if (cached) return cached;

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

  try {
    const result = await createEnhancedCompletion(messages, { temperature: 0.6 });
    await cacheManager.set(cacheKey, JSON.parse(result));
    return JSON.parse(result);
  } catch (error) {
    logger.error('Suggestion generation failed:', error);
    return {};
  }
}

/**
 * Generate AI-powered testimonial with advanced customization
 * @param {Object} options - Configuration options for testimonial generation
 * @returns {Promise<Object>} Generated testimonial and metadata
 */
export const generateAITestimonial = async (options = {}) => {
  const {
    projectDetails,
    seekerProfile,
    giverProfile,
    tone = TESTIMONIAL_CONFIG.TONES.PROFESSIONAL,
    length = TESTIMONIAL_CONFIG.LENGTHS.MEDIUM,
    focusAreas = [TESTIMONIAL_CONFIG.FOCUS_AREAS.SKILLS, TESTIMONIAL_CONFIG.FOCUS_AREAS.IMPACT],
    industry,
    relationship,
    duration,
    achievements = [],
    keywords = [],
    style = {},
    userId
  } = options;

  // Validate inputs
  if (!projectDetails || !seekerProfile) {
    throw createError('validation', 'Project details and seeker profile are required');
  }

  // Generate cache key based on input parameters
  const cacheKey = cacheManager.generateKey('testimonial_gen', {
    projectDetails,
    seekerProfile,
    tone,
    length,
    focusAreas,
    industry
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
          style
        });

        const messages = [
          {
            role: "system",
            content: `You are an expert testimonial writer with deep understanding of ${industry || 'various industries'}. 
                     Generate authentic, impactful testimonials that highlight real value and specific contributions.`
          },
          {
            role: "user",
            content: contextPrompt
          }
        ];

        // Generate initial testimonial
        const rawTestimonial = await createEnhancedCompletion(messages, {
          temperature: 0.7,
          maxTokens: length.max * 2,
          userId,
          context: { operation: 'generateTestimonial' }
        });

        // Parse and enhance the generated testimonial
        const enhancedTestimonial = await enhanceTestimonialContent(rawTestimonial, {
          tone,
          focusAreas,
          industry,
          keywords
        });

        // Analyze sentiment and authenticity
        const [sentiment, authenticity] = await Promise.all([
          analyzeDetailedSentiment(enhancedTestimonial.content),
          analyzeTestimonialAuthenticity(enhancedTestimonial.content)
        ]);

        // Generate alternative versions with different tones
        const alternatives = await generateAlternativeVersions(enhancedTestimonial.content, {
          tones: [TESTIMONIAL_CONFIG.TONES.CASUAL, TESTIMONIAL_CONFIG.TONES.ENTHUSIASTIC],
          length
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
              impactScore: calculateImpactScore(enhancedTestimonial)
            },
            keywords: extractKeyPhrases(enhancedTestimonial.content),
            focusAreas: analyzeContentFocus(enhancedTestimonial.content, focusAreas),
            suggestions: enhancedTestimonial.suggestions
          },
          generated: new Date().toISOString()
        };

        // Track metrics
        metrics.timing('ai.testimonial.generation', Date.now(), {
          industry,
          tone,
          length: Object.keys(TESTIMONIAL_CONFIG.LENGTHS).find(key => 
            TESTIMONIAL_CONFIG.LENGTHS[key] === length
          )
        });

        return result;
      },
      AI_CONFIG.CACHE.TTL
    );
  } catch (error) {
    logger.error('Testimonial generation failed:', error);
    metrics.increment('ai.testimonial.generation.error');
    throw createError('processing', 'Failed to generate testimonial', {
      cause: error,
      details: { userId, industry }
    });
  }
};

/**
 * Helper function to construct detailed prompt for testimonial generation
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
    style
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
    ${achievements.map(achievement => `- ${achievement}`).join('\n')}

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
 * Helper function to enhance testimonial content
 */
const enhanceTestimonialContent = async (content, options) => {
  const { tone, focusAreas, industry, keywords } = options;

  try {
    const messages = [
      {
        role: "system",
        content: `Enhance this testimonial while maintaining authenticity:
          - Adjust tone to be ${tone}
          - Focus on these areas: ${focusAreas.join(', ')}
          - Use appropriate ${industry || 'professional'} terminology
          - Incorporate relevant keywords: ${keywords.join(', ')}
          Return a JSON object with enhanced content and suggestions.`
      },
      {
        role: "user",
        content: `Enhance: "${content}"`
      }
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.6,
      maxTokens: 500,
      context: { operation: 'enhanceContent' }
    });

    const enhanced = JSON.parse(result);
    
    return {
      content: content,
      enhanced: enhanced.content,
      suggestions: enhanced.suggestions,
      improvements: enhanced.improvements
    };
  } catch (error) {
    logger.error('Content enhancement failed:', error);
    return { content, enhanced: content, suggestions: [], improvements: [] };
  }
};

/**
 * Helper function to analyze testimonial authenticity
 */
const analyzeTestimonialAuthenticity = async (content) => {
  try {
    const messages = [
      {
        role: "system",
        content: `Analyze testimonial authenticity based on:
          - Language naturality
          - Specific details presence
          - Personal voice consistency
          - Credibility markers
          - Emotional resonance
          Return a detailed JSON analysis with scores and explanations.`
      },
      {
        role: "user",
        content: `Analyze authenticity: "${content}"`
      }
    ];

    const result = await createEnhancedCompletion(messages, {
      temperature: 0.3,
      maxTokens: 300,
      context: { operation: 'analyzeAuthenticity' }
    });

    const analysis = JSON.parse(result);
    
    return {
      score: analysis.overall_score,
      aspects: analysis.aspect_scores,
      markers: analysis.authenticity_markers,
      suggestions: analysis.improvement_suggestions
    };
  } catch (error) {
    logger.error('Authenticity analysis failed:', error);
    return { score: 0.5, aspects: {}, markers: [], suggestions: [] };
  }
};

/**
 * Helper function to generate alternative versions
 */
const generateAlternativeVersions = async (content, options) => {
  const { tones, length } = options;

  try {
    const alternatives = await Promise.all(
      tones.map(async tone => {
        const messages = [
          {
            role: "system",
            content: `Rewrite this testimonial in a ${tone} tone while:
              - Maintaining core message and facts
              - Adjusting language and style
              - Keeping length between ${length.min}-${length.max} words
              - Preserving professional credibility
              Return the rewritten version with tone markers.`
          },
          {
            role: "user",
            content: `Rewrite: "${content}"`
          }
        ];

        const result = await createEnhancedCompletion(messages, {
          temperature: 0.7,
          maxTokens: length.max * 2,
          context: { operation: 'generateAlternative' }
        });

        return {
          tone,
          content: result,
          wordCount: result.split(/\s+/).length,
          timestamp: new Date().toISOString()
        };
      })
    );

    return alternatives.filter(alt => 
      alt.wordCount >= length.min && 
      alt.wordCount <= length.max
    );
  } catch (error) {
    logger.error('Alternative generation failed:', error);
    return [];
  }
};

/**
 * Helper function to calculate readability score
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
 * Helper function to calculate impact score
 */
const calculateImpactScore = (testimonial) => {
  const impactFactors = {
    specificity: hasSpecificDetails(testimonial.content),
    metrics: hasQuantitativeMetrics(testimonial.content),
    clarity: testimonial.stats.readabilityScore / 100,
    sentiment: testimonial.metadata.sentiment.score,
    authenticity: testimonial.metadata.authenticity.score
  };

  return Object.values(impactFactors).reduce((acc, val) => acc + val, 0) / 
         Object.keys(impactFactors).length;
};

/**
 * Helper function to extract key phrases
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
 * Helper function to analyze content focus
 */
const analyzeContentFocus = (content, targetAreas) => {
  const analysis = {};
  
  for (const area of targetAreas) {
    analysis[area] = {
      coverage: calculateAreaCoverage(content, area),
      keywords: extractAreaKeywords(content, area),
      suggestions: generateAreaSuggestions(content, area)
    };
  }
  
  return analysis;
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
  generateTestimonialSuggestions,
  generateAITestimonial,
  enhanceTestimonialContent,
  analyzeTestimonialAuthenticity, 
  generateAlternativeVersions,
  calculateReadabilityScore,
  calculateImpactScore,
  extractKeyPhrases,
  analyzeContentFocus,
  constructTestimonialPrompt,
  TESTIMONIAL_CONFIG,
  AI_CONFIG,
  AIRateLimiter,
  CircuitBreaker
};