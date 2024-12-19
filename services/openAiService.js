import { Configuration, OpenAIApi } from "openai";
import dotenv from "dotenv";
import { openai } from '../config/openAI.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Generate personalized feedback for seekers based on testimonial content
 * @param {string} testimonialText - The text of the testimonial
 * @returns {Promise<string>} - Returns AI-generated feedback for the seeker
 */
export const generateFeedback = async (testimonialText) => {
  try {
    const prompt = `Provide detailed feedback and suggest improvements for the following testimonial: "${testimonialText}"`;

    const response = await openai.createCompletion({
      model: "text-davinci-003",
      prompt,
      max_tokens: 150, // Length of the feedback
      temperature: 0.7, // Creativity of the response
    });

    const feedback = response.data.choices[0].text.trim();
    return feedback;
  } catch (error) {
    if (error.response) {
      if (error.response.status === 429) {
        logger.error("❌ Rate limit exceeded. Please try again later.");
        throw new Error("Rate limit exceeded. Please try again later.");
      } else if (error.response.data && error.response.data.error && error.response.data.error.code === "insufficient_quota") {
        logger.error("❌ Quota exceeded. Please upgrade your OpenAI plan.");
        throw new Error("Quota exceeded. Please upgrade your OpenAI plan.");
      } else {
        logger.error(`❌ OpenAI API Error: ${error.response.status} - ${error.response.data.error.message}`);
        throw new Error(`OpenAI API Error: ${error.response.data.error.message}`);
      }
    } else if (error.request) {
      logger.error("❌ No response received from OpenAI API.");
      throw new Error("No response received from OpenAI API.");
    } else {
      logger.error(`❌ OpenAI Service Error: ${error.message}`);
      throw new Error("Failed to generate AI feedback.");
    }
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

    const response = await openai.createCompletion({
      model: "text-davinci-003",
      prompt,
      max_tokens: 100,
      temperature: 0.7,
    });

    const skills = response.data.choices[0].text
      .trim()
      .split(",")
      .map((s) => s.trim());
    return skills;
  } catch (error) {
    if (error.response) {
      if (error.response.status === 429) {
        logger.error("❌ Rate limit exceeded. Please try again later.");
        throw new Error("Rate limit exceeded. Please try again later.");
      } else if (error.response.data && error.response.data.error && error.response.data.error.code === "insufficient_quota") {
        logger.error("❌ Quota exceeded. Please upgrade your OpenAI plan.");
        throw new Error("Quota exceeded. Please upgrade your OpenAI plan.");
      } else {
        logger.error(`❌ OpenAI API Error: ${error.response.status} - ${error.response.data.error.message}`);
        throw new Error(`OpenAI API Error: ${error.response.data.error.message}`);
      }
    } else if (error.request) {
      logger.error("❌ No response received from OpenAI API.");
      throw new Error("No response received from OpenAI API.");
    } else {
      logger.error(`❌ OpenAI Service Error: ${error.message}`);
      throw new Error("Failed to extract skills.");
    }
  }
};

/**
 * Generate a response from OpenAI based on user input.
 * @param {string} userMessage - The message from the user.
 * @returns {string} - The response from OpenAI.
 */
export const generateResponse = async (userMessage) => {
  try {
    const response = await openai.createChatCompletion({
      model: "gpt-4", // Ensure the model name is valid
      messages: [{ role: "user", content: userMessage }],
    });
    const reply = response.data.choices[0].message.content;
    return reply;
  } catch (error) {
    if (error.response) {
      if (error.response.status === 429) {
        logger.error("❌ Rate limit exceeded. Please try again later.");
        throw new Error("Rate limit exceeded. Please try again later.");
      } else if (error.response.data && error.response.data.error && error.response.data.error.code === "insufficient_quota") {
        logger.error("❌ Quota exceeded. Please upgrade your OpenAI plan.");
        throw new Error("Quota exceeded. Please upgrade your OpenAI plan.");
      } else {
        logger.error(`❌ OpenAI API Error: ${error.response.status} - ${error.response.data.error.message}`);
        throw new Error(`OpenAI API Error: ${error.response.data.error.message}`);
      }
    } else if (error.request) {
      logger.error("❌ No response received from OpenAI API.");
      throw new Error("No response received from OpenAI API.");
    } else {
      logger.error(`❌ OpenAI Service Error: ${error.message}`);
      throw new Error("Failed to generate response from OpenAI.");
    }
  }
};
