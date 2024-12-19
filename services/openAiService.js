import dotenv from "dotenv";
import { openai } from "../config/openAI.js";
import { logger } from "../utils/logger.js";

dotenv.config();

/**
 * Handle OpenAI Errors
 * @param {Error} error - The error object thrown by OpenAI methods
 */
function handleOpenAIError(error) {
  if (error.status) {
    // This is likely an HTTPError with a status code
    if (error.status === 429) {
      logger.error("❌ Rate limit exceeded. Please try again later.");
      throw new Error("Rate limit exceeded. Please try again later.");
    } else if (
      error.body &&
      error.body.error &&
      error.body.error.code === "insufficient_quota"
    ) {
      logger.error("❌ Quota exceeded. Please upgrade your OpenAI plan.");
      throw new Error("Quota exceeded. Please upgrade your OpenAI plan.");
    } else {
      logger.error(
        `❌ OpenAI API Error: ${error.status} - ${error.body?.error?.message || error.message}`
      );
      throw new Error(`OpenAI API Error: ${error.body?.error?.message || error.message}`);
    }
  } else {
    // Some other error (network issues, etc.)
    logger.error(`❌ OpenAI Service Error: ${error.message}`);
    throw new Error("Failed to process request using OpenAI.");
  }
}

/**
 * Generate personalized feedback for seekers based on testimonial content
 * @param {string} testimonialText - The text of the testimonial
 * @returns {Promise<string>} - Returns AI-generated feedback for the seeker
 */
export const generateFeedback = async (testimonialText) => {
  try {
    const prompt = `Provide detailed feedback and suggest improvements for the following testimonial: "${testimonialText}"`;

    const response = await openai.completions.create({
      model: "text-davinci-003",
      prompt,
      max_tokens: 150,
      temperature: 0.7,
    });

    const feedback = response.choices[0].text.trim();
    return feedback;
  } catch (error) {
    handleOpenAIError(error);
  }
};

/**
 * Extract key skills and traits from the testimonial
 * @param {string} testimonialText - The testimonial to analyze
 * @returns {Promise<string[]>} - Returns an array of skills/qualities
 */
export const extractSkills = async (testimonialText) => {
  try {
    const prompt = `Extract and list key skills and qualities from this testimonial: "${testimonialText}"`;

    const response = await openai.completions.create({
      model: "text-davinci-003",
      prompt,
      max_tokens: 100,
      temperature: 0.7,
    });

    const skills = response.choices[0].text
      .trim()
      .split(",")
      .map((s) => s.trim());
    return skills;
  } catch (error) {
    handleOpenAIError(error);
  }
};

/**
 * Generate a response from OpenAI based on user input.
 * @param {string} userMessage - The message from the user.
 * @returns {string} - The response from OpenAI.
 */
export const generateResponse = async (userMessage) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: userMessage }],
    });
    const reply = response.choices[0].message.content;
    return reply;
  } catch (error) {
    handleOpenAIError(error);
  }
};