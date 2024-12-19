// src/services/skillExtractionService.js

import { openai } from "../config/openAI.js";
import { logger } from "../utils/logger.js";
import AppError from '../utils/appError.js';

/**
 * Extracts skills from the provided testimonials.
 * @param {Array<Object>} testimonials - Array of testimonial objects.
 * @returns {Array<Object>} skills - Extracted skills with mentions and context.
 */
export const extractSkills = async (testimonials) => {
  const testimonialTexts = testimonials.map(t => t.givers.testimonial).join("\n");

  const prompt = `
You are an expert skills extraction assistant. From the following testimonials, extract skills along with the number of mentions and contextual information.

Testimonials:
${testimonialTexts}

Return ONLY the JSON array without explanations. Each object should have:
- "skill": string
- "mentions": number
- "context": string
`;

  try {
    const response = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a professional skills extraction assistant." },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
    });

    const content = response.data.choices[0].message.content.trim();

    // Attempt to parse JSON
    let skills;
    try {
      skills = JSON.parse(content);
    } catch (jsonErr) {
      logger.error("❌ Failed to parse skills extraction JSON:", jsonErr);
      throw new AppError('Skills extraction failed to parse the response.', 500);
    }

    return skills;
  } catch (error) {
    logger.error("❌ Error extracting skills:", error);
    throw new AppError('Skills extraction service failed.', 500);
  }
};
