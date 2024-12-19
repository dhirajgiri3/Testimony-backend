// src/services/sentimentService.js

import { openai } from "../config/openAI.js";
import { logger } from "../utils/logger.js";
import AppError from '../utils/appError.js';

/**
 * Performs sentiment analysis on the provided testimonials.
 * @param {Array<Object>} testimonials - Array of testimonial objects.
 * @returns {Object} sentimentData - Processed sentiment analysis results.
 */
export const performSentimentAnalysis = async (testimonials) => {
  const testimonialTexts = testimonials.map(t => t.givers.testimonial).join("\n");

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
        { role: "system", content: "You are a professional sentiment analysis assistant." },
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
      throw new AppError('Sentiment analysis failed to parse the response.', 500);
    }

    return sentimentData;
  } catch (error) {
    logger.error("❌ Error performing sentiment analysis:", error);
    throw new AppError('Sentiment analysis service failed.', 500);
  }
};