import axios from "axios";
import { logger } from "../utils/logger.js";

/**
 * Sends exported data to a specified callback URL via POST request with enhanced error handling.
 * @param {string} url - The callback URL to send the data to.
 * @param {Object} data - The data to be sent.
 * @returns {Promise<void>}
 */
export const sendDataToUrl = async (url, data) => {
  try {
    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    logger.info(`✅ Data successfully sent to URL: ${url} - Status: ${response.status}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(`❌ Failed to send data to URL: ${url} - Axios Error: ${error.message}`);
    } else {
      logger.error(`❌ Failed to send data to URL: ${url} - Error: ${error.message}`);
    }
    throw error; // Throw to handle retries
  }
};