// src/services/nlpService.js

import { pipeline } from "@huggingface/transformers";
import { logger } from "../utils/logger.js";

/**
 * Initialize NLP Pipelines
 */
const sentimentPipeline = pipeline("sentiment-analysis");
const emotionPipeline = pipeline("text-classification", {
  model: "j-hartmann/emotion-english-distilroberta-base",
});
const nerPipeline = pipeline("ner", { grouped_entities: true });

/**
 * Extract Skills from Testimonial Text using spaCy-like NER
 * @param {string} text
 * @returns {Array<string>} Extracted skills
 */
export const extractSkills = async (text) => {
  try {
    // Assuming skills are labeled as 'SKILL' in NER model
    const nerResults = await nerPipeline(text);
    const skills = nerResults
      .filter((entity) => entity.entity_group === "SKILL")
      .map((entity) => entity.word);
    return skills;
  } catch (error) {
    logger.error("❌ Error extracting skills:", error);
    return [];
  }
};

/**
 * Analyze Sentiment of Testimonial Text using HuggingFace BERT
 * @param {string} text
 * @returns {Object} Sentiment label and score
 */
export const analyzeSentiment = async (text) => {
  try {
    const sentiment = await sentimentPipeline(text);
    // Convert to score between -1 to 1
    const score =
      sentiment[0].label === "POSITIVE"
        ? sentiment[0].score
        : -sentiment[0].score;
    return { label: sentiment[0].label, score };
  } catch (error) {
    logger.error("❌ Error analyzing sentiment:", error);
    return { label: "NEUTRAL", score: 0 };
  }
};

/**
 * Analyze Emotions in Testimonial Text using HuggingFace Emotion Model
 * @param {string} text
 * @returns {Object} Emotion scores
 */
export const analyzeEmotions = async (text) => {
  try {
    const emotions = await emotionPipeline(text);
    const emotionScores = {};
    emotions.forEach((emotion) => {
      emotionScores[emotion.label.toLowerCase()] = emotion.score;
    });
    return emotionScores;
  } catch (error) {
    logger.error("❌ Error analyzing emotions:", error);
    return {};
  }
};

/**
 * Categorize Project based on Project Details using NLP
 * @param {string} projectDetails
 * @returns {string} Project Category
 */
export const categorizeProject = async (projectDetails) => {
  try {
    const prompt = `
    Categorize the following project details into one of the predefined categories: Web Development, Mobile Development, Marketing, Design, Consulting, Content Creation, Other.

    Project Details:
    "${projectDetails}"

    Category:
    `;

    const response = await openai.createCompletion({
      model: "gpt-4",
      prompt,
      max_tokens: 10,
      temperature: 0.3,
      n: 1,
      stop: ["\n"],
    });

    const category = response.data.choices[0].text.trim().replace(/["']/g, "");
    const validCategories = [
      "Web Development",
      "Mobile Development",
      "Marketing",
      "Design",
      "Consulting",
      "Content Creation",
      "Other",
    ];
    return validCategories.includes(category) ? category : "Other";
  } catch (error) {
    logger.error("❌ Error categorizing project:", error);
    return "Other";
  }
};
