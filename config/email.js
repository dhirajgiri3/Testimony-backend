// /backend/config/email.js

import nodemailer from "nodemailer";
import { logger } from "../utils/logger.js";
import dotenv from "dotenv";
import AppError from "../utils/appError.js";

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST || "smtp.mailtrap.io",
  port: process.env.MAILTRAP_PORT || 2525, // Changed from 587 to 2525
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS,
  },
  secure: false, // true for 465, false for other ports
});

/**
 * Verify the transporter configuration
 */
transporter.verify(function (error, success) {
  if (error) {
    logger.error("❌ Error verifying email transporter:", error);
  } else {
    logger.info("✅ Server is ready to send emails");
  }
});

/**
 * Send an email with retry logic
 * @param {Object} mailOptions
 */
export const sendEmail = async (mailOptions) => {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      await transporter.sendMail(mailOptions);
      logger.info(`✅ Email sent to ${mailOptions.to}`);
      return;
    } catch (error) {
      attempt++;
      logger.error(
        `❌ Failed to send email to ${mailOptions.to}. Attempt ${attempt} of ${maxRetries}. Error: ${error.message}`
      );
      if (attempt >= maxRetries) {
        throw new AppError(
          `Failed to send email to ${mailOptions.to} after ${maxRetries} attempts`,
          500
        );
      }
      // Exponential backoff before retrying
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }
};

export { transporter };
