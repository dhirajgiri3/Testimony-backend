// src/services/sentimentService.js

import { openai } from "../config/openAI.js";
import { logger } from "../utils/logger.js";
import AppError from "../utils/appError.js";
import { promisify } from "util";
import redisClient from "../config/redis.js";
import crypto from "crypto";

// Function to hash text
const hashText = (text) => {
  return crypto.createHash("sha256").update(text).digest("hex");
};

// Function to get cached sentiment
const getCachedSentiment = async (text) => {
  const cacheKey = `sentiment:${hashText(text)}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  return null;
};

// Function to set cached sentiment
const setCachedSentiment = async (text, sentiment) => {
  const cacheKey = `sentiment:${hashText(text)}`;
  await redisClient.set(cacheKey, JSON.stringify(sentiment), "EX", 3600); // Cache for 1 hour
};

// Retry mechanism
const retry = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
};

// Sentiment analysis method
export const analyzeSentiment = async (texts) => {
  try {
    // Check cache
    const cachedResults = await Promise.all(texts.map(getCachedSentiment));
    const results = cachedResults.map((cached, index) => cached || null);

    // Identify texts that need analysis
    const textsToAnalyze = texts.filter((_, index) => !results[index]);

    // Batch API requests
    const batchSize = 10;
    for (let i = 0; i < textsToAnalyze.length; i += batchSize) {
      const batch = textsToAnalyze.slice(i, i + batchSize);
      const sentimentBatch = await retry(async () => {
        const responses = await Promise.all(
          batch.map((text) => {
            return openai.createCompletion({
              model: "text-davinci-003",
              prompt: `Analyze the sentiment of the following text and provide a score between -1 and 1:\n\n"${text}"`,
              max_tokens: 5,
              temperature: 0,
            });
          })
        );
        return responses.map((response) =>
          parseFloat(response.data.choices[0].text.trim())
        );
      });

      // Cache and assign results
      sentimentBatch.forEach((sentiment, idx) => {
        setCachedSentiment(batch[idx], sentiment);
        const originalIndex = texts.indexOf(batch[idx]);
        results[originalIndex] = sentiment;
      });
    }
    return results;
  } catch (error) {
    logger.error("Sentiment analysis failed:", error);
    throw new AppError("Sentiment analysis failed", 500);
  }
};

/**
 * Performs sentiment analysis on the provided testimonials.
 * @param {Array<Object>} testimonials - Array of testimonial objects.
 * @returns {Object} sentimentData - Processed sentiment analysis results.
 */
export const performSentimentAnalysis = async (testimonials) => {
  const testimonialTexts = testimonials
    .map((t) => t.givers.testimonial)
    .join("\n");

  const prompt = `
You are an expert sentiment analysis assistant. Analyze the following testimonials and provide:
- Overall sentiment (very positive, positive, mixed, negative)
- Emotions with their intensities
- Common praises
- Common criticisms

Testimonials:
${testimonialTexts}
  
Return ONLY the JSON object without explanations.
`;

  try {
    const response = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a professional sentiment analysis assistant.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    });

    const content = response.data.choices[0].message.content.trim();

    // Attempt to parse JSON
    let sentimentData;
    try {
      sentimentData = JSON.parse(content);
    } catch (jsonErr) {
      logger.error("❌ Failed to parse sentiment analysis JSON:", jsonErr);
      throw new AppError(
        "Sentiment analysis failed to parse the response.",
        500
      );
    }

    return sentimentData;
  } catch (error) {
    logger.error("❌ Error performing sentiment analysis:", error);
    throw new AppError("Sentiment analysis service failed.", 500);
  }
};
