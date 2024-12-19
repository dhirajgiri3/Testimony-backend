import dotenv from "dotenv";
import OpenAI from "openai";
import { logger } from "../utils/logger.js";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export { openai };

export const testOpenAIConnection = async () => {
  try {
    const models = await openai.models.list();
    if (models && models.data) {
      logger.info("✅ OpenAI connected successfully and accessible.");
    } else {
      logger.warn("⚠️ OpenAI responded, but no models data returned. Check your API key/plan.");
    }
  } catch (error) {
    // If listing models is restricted, you can try a minimal completion request to test connectivity.
    logger.error(`❌ Failed to connect to OpenAI: ${error.message}`);
  }
};