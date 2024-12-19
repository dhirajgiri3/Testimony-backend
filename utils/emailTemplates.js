// src/utils/emailTemplates.js

/**
 * Create verification email HTML template
 * @param {string} verificationLink
 * @returns {string} HTML content
 */
export const createVerificationEmailTemplate = (verificationLink) => `
  <h1>Verify Your Email</h1>
  <p>Please click the link below to verify your email address:</p>
  <a href="${verificationLink}" target="_blank">Verify Email</a>
  <p>If you did not create an account, please ignore this email.</p>
  <p>Thank you!</p>
`;

/**
 * Create testimonial request email HTML template
 * @param {string} link
 * @param {string} seekerName
 * @param {string} projectDetails
 * @returns {string} HTML content
 */
export const createTestimonialRequestEmailTemplate = (
  link,
  seekerName,
  projectDetails
) => `
  <h1>Testimonial Request</h1>
  <p>Hello,</p>
  <p>${seekerName} has requested a testimonial from you regarding the following project:</p>
  <p><strong>Project Details:</strong> ${projectDetails}</p>
  <p>Please submit your testimonial by clicking the link below:</p>
  <a href="${link}" target="_blank">Submit Testimonial</a>
  <p>If you did not request this, please ignore this email.</p>
  <p>Thank you!</p>
`;

/**
 * Create password reset email HTML template
 * @param {string} resetUrl
 * @returns {string} HTML content
 */
export const createPasswordResetEmailTemplate = (resetUrl) => `
  <h1>Password Reset Request</h1>
  <p>Please click the link below to reset your password:</p>
  <a href="${resetUrl}" target="_blank">Reset Password</a>
  <p>If you did not request this, please ignore this email.</p>
  <p>Thank you!</p>
`;
