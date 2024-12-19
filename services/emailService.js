// src/services/emailService.js

import { transporter } from "../config/email.js";
import { logger } from "../utils/logger.js";
import {
  createVerificationEmailTemplate,
  createPasswordResetEmailTemplate,
  createTestimonialRequestEmailTemplate,
} from "../utils/emailTemplates.js";
import AppError from "../utils/appError.js";
import asyncHandler from "express-async-handler";

/**
 * Generic function to send emails with enhanced retry logic
 * @param {Object} mailOptions - Nodemailer mail options
 * @param {number} retries - Number of retry attempts
 * @private
 */
async function sendEmailWithRetry(mailOptions, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await transporter.sendMail({
        ...mailOptions,
        from: process.env.EMAIL_FROM || 'noreply@testimony.com'
      });
      logger.info(`✅ Email sent to ${mailOptions.to}`);
      return;
    } catch (error) {
      logger.error(
        `❌ Attempt ${attempt} to send email to ${mailOptions.to} failed: ${error.message}`
      );
      if (attempt === retries) {
        // Send an alert to admin or log to monitoring service
        logger.error(`❌ All attempts to send email to ${mailOptions.to} failed`);
        throw new AppError("Failed to send email after multiple attempts", 500);
      }
      // Exponential backoff with jitter
      const delay = (Math.pow(2, attempt) + Math.random()) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Send verification email
 * @param {string} email - Recipient's email address
 * @param {string} verificationUrl - Verification URL
 */
export async function sendVerificationEmail(email, verificationUrl) {
  try {
    const html = createVerificationEmailTemplate(verificationUrl);
    await sendEmailWithRetry({
      to: email,
      subject: "Email Verification",
      html,
    });
    logger.info(`✅ Verification email sent to ${email}`);
  } catch (error) {
    logger.error(
      `❌ Error sending verification email to ${email}: ${error.message}`
    );
    throw new AppError("Email could not be sent", 500);
  }
}

/**
 * Send password reset email
 * @param {string} email - Recipient's email address
 * @param {string} resetToken - Password reset token
 */
export async function sendPasswordResetEmail(email, resetToken) {
  try {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    const html = createPasswordResetEmailTemplate(resetUrl);
    await sendEmailWithRetry({
      to: email,
      subject: "Password Reset Request",
      html,
    });
    logger.info(`✅ Password reset email sent to ${email}`);
    return true;
  } catch (error) {
    logger.error(
      `❌ Error sending password reset email to ${email}: ${error.message}`
    );
    throw new AppError("Password reset email could not be sent", 500);
  }
}

/**
 * Send testimonial request email
 * @param {string} giverEmail - Giver's email address
 * @param {string} link - Testimonial submission link
 * @param {string} seekerName - Seeker's name
 * @param {string} projectDetails - Project details
 */
export async function sendTestimonialRequestEmail(giverEmail, link, seekerName, projectDetails) {
  try {
    const html = createTestimonialRequestEmailTemplate(
      link,
      seekerName,
      projectDetails
    );
    await sendEmailWithRetry({
      to: giverEmail,
      subject: "Testimonial Request",
      html,
    });
    logger.info(`✅ Testimonial request email sent to ${giverEmail}`);
  } catch (error) {
    logger.error(
      `❌ Error sending testimonial request email to ${giverEmail}: ${error.message}`
    );
    throw new AppError("Testimonial request email could not be sent", 500);
  }
}

/**
 * Initiate Password Reset
 */
export const initiatePasswordResetHandler = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    throw new AppError("Email is required", 400);
  }

  const user = await User.findOne({ email });

  // Always respond with success message to prevent user enumeration
  if (user) {
    const resetToken = user.generateResetPasswordToken();
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpiry = Date.now() + 3600000; // 1 hour

    await user.save({ validateBeforeSave: false });

    await emailService.sendPasswordResetEmail(user.email, resetToken);
  }

  res.status(200).json({
    success: true,
    message: "Password reset instructions sent to your email.",
  });
});

// Export all email service functions
const emailService = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendTestimonialRequestEmail,
  initiatePasswordResetHandler,
};

export default emailService;
