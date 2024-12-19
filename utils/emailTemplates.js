// src/utils/emailTemplates.js

/**
 * Create Email Verification Template
 * @param {string} verificationUrl - URL for email verification
 * @returns {string} - HTML content
 */
export const createVerificationEmailTemplate = (verificationUrl) => {
  return `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Email Verification</h2>
          <p>Thank you for registering. Please verify your email by clicking the link below:</p>
          <a href="${verificationUrl}" style="display: inline-block; padding: 10px 20px; background-color: #1a73e8; color: #fff; text-decoration: none; border-radius: 5px;">Verify Email</a>
          <p>If you did not create an account, please ignore this email.</p>
          <hr>
          <p style="font-size: 12px; color: #888;">© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
      </div>
  `;
};

/**
 * Create Password Reset Email Template
 * @param {string} resetUrl - URL for password reset
 * @returns {string} - HTML content
 */
export const createPasswordResetEmailTemplate = (resetUrl) => {
  return `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Password Reset Request</h2>
          <p>We received a request to reset your password. Click the link below to proceed:</p>
          <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #34a853; color: #fff; text-decoration: none; border-radius: 5px;">Reset Password</a>
          <p>This link will expire in 10 minutes.</p>
          <p>If you did not request a password reset, please ignore this email.</p>
          <hr>
          <p style="font-size: 12px; color: #888;">© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
      </div>
  `;
};

/**
 * Create Testimonial Request Email Template
 * @param {string} link - Testimonial submission link
 * @param {string} seekerName - Seeker's name
 * @param {string} projectDetails - Project details
 * @returns {string} - HTML content
 */
export const createTestimonialRequestEmailTemplate = (
  link,
  seekerName,
  projectDetails
) => {
  return `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Testimonial Request</h2>
          <p>Hi,</p>
          <p>${seekerName} has requested a testimonial for the following project:</p>
          <p><strong>Project Details:</strong> ${projectDetails}</p>
          <p>Please click the link below to submit your testimonial:</p>
          <a href="${link}" style="display: inline-block; padding: 10px 20px; background-color: #fbbc05; color: #fff; text-decoration: none; border-radius: 5px;">Submit Testimonial</a>
          <p>Thank you for your time!</p>
          <hr>
          <p style="font-size: 12px; color: #888;">© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
      </div>
  `;
};
