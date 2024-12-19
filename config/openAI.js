import dotenv from "dotenv";
import { Configuration, OpenAIApi } from "openai";
import { logger } from "../utils/logger.js";

dotenv.config();

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

/**
 * Create a chat completion using OpenAI API with enhanced error handling.
 */
async function createCompletion() {
  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-4", // Ensure the model name is valid
      messages: [{ role: "user", content: "write a haiku about ai" }],
    });
    console.log(completion.data.choices[0].message.content);
    return completion;
  } catch (error) {
    if (error.response) {
      // API responded with a status outside the 2xx range
      if (error.response.status === 429) {
        // Handle rate limit exceeded
        logger.error("❌ Rate limit exceeded. Please try again later.");
      } else if (
        error.response.data &&
        error.response.data.error &&
        error.response.data.error.code === "insufficient_quota"
      ) {
        // Handle quota exceeded
        logger.error("❌ Quota exceeded. Please upgrade your OpenAI plan.");
      } else {
        // Handle other API errors
        logger.error(
          `❌ OpenAI API Error: ${error.response.status} - ${error.response.data.error.message}`
        );
      }
    } else if (error.request) {
      // No response received
      logger.error("❌ No response received from OpenAI API.");
    } else {
      // Other errors
      logger.error(`❌ OpenAI Completion Error: ${error.message}`);
    }
    // Optionally, implement fallback logic or notify administrators
  }
}

createCompletion();

export { openai };
