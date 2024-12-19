// src/services/nlpService.js

import { pipeline } from "@huggingface/transformers";
import { logger } from "../utils/logger.js";
import { Configuration, OpenAIApi } from "openai";
import AppError from "../utils/appError.js";

// Initialize HuggingFace pipelines with error handling
let sentimentPipeline;
let emotionPipeline;
let nerPipeline;

const initializePipelines = async () => {
  try {
    sentimentPipeline = await pipeline("sentiment-analysis");
    emotionPipeline = await pipeline("text-classification", {
      model: "j-hartmann/emotion-english-distilroberta-base",
    });
    nerPipeline = await pipeline("ner", { grouped_entities: true });
  } catch (error) {
    logger.error(`❌ Pipeline Initialization Error: ${error.message}`);
    throw new AppError("Failed to initialize NLP pipelines", 500);
  }
};

// Initialize OpenAI API
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Call initialization
initializePipelines();

/**
 * Generate AI Testimonial Suggestion
 * @param {string} projectDetails
 * @param {Array<string>} skills
 * @returns {string} Suggested Testimonial
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
      ${skills.join(", ")}

      Provide a well-structured testimonial that highlights the user's expertise and the success of the project.
    `;

    const response = await openai.createCompletion({
      model: "text-davinci-003",
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
    logger.error(`❌ AI Testimonial Suggestion Error: ${error.message}`);
    throw new AppError("Failed to generate testimonial suggestion", 500);
  }
};

/**
 * Handle Chat Query using OpenAI's ChatGPT
 * @param {string} query
 * @returns {string} Chat Response
 */
export const handleChatQuery = async (query) => {
  try {
    const response = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: query },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const chatResponse = response.data.choices[0].message.content.trim();
    return chatResponse;
  } catch (error) {
    logger.error(`❌ Chat Query Error: ${error.message}`);
    throw new AppError("Failed to process chat query", 500);
  }
};

/**
 * Get Advanced Insights for a Seeker
 * @param {string} seekerId
 * @returns {Object} Advanced Insights
 */
export const getAdvancedInsights = async (seekerId) => {
  try {
    // Fetch seeker data (implementation needed)
    const seekerData = await fetchSeekerData(seekerId);

    if (!seekerData) {
      throw new AppError("Seeker data not found", 404);
    }

    // Analyze sentiments
    const sentiments = await sentimentPipeline(seekerData.testimonials);
    const averageSentiment =
      sentiments.reduce((acc, curr) => acc + (curr.score || 0), 0) / sentiments.length;

    // Extract top skills
    const skills = await nerPipeline(seekerData.profile);
    const topSkills = extractTopSkills(skills);

    // Example Insight Generation
    const insights = {
      averageSentiment: averageSentiment > 0.5 ? "Positive" : "Neutral/Negative",
      topSkills,
      projectSuccessRate: "95%",
    };

    return insights;
  } catch (error) {
    logger.error(`❌ Get Advanced Insights Error: ${error.message}`);
    throw new AppError("Failed to retrieve advanced insights", 500);
  }
};

/**
 * Placeholder function to fetch seeker data
 * @param {string} seekerId
 * @returns {Object} Seeker Data
 */
const fetchSeekerData = async (seekerId) => {
  // Implement actual data fetching logic
  return {
    testimonials: ["Great work on the project!", "Highly skilled and professional."],
    profile: "Expert in JavaScript, Node.js, and Express.",
  };
};

/**
 * Extract top skills from NER results
 * @param {Array} nerResults
 * @returns {Array<string>} Top Skills
 */
const extractTopSkills = (nerResults) => {
  const skillSet = new Set();
  nerResults.forEach((entity) => {
    if (entity.entity === "SKILL") {
      skillSet.add(entity.word);
    }
  });
  return Array.from(skillSet).slice(0, 5);
};
