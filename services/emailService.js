// src/services/emailService.js

import { transporter, sendEmail } from '../config/email.js';
import { logger } from '../utils/logger.js';
import { createTestimonialRequestEmailTemplate, createVerificationEmailTemplate, createPasswordResetEmailTemplate } from '../utils/emailTemplates.js';

/**
 * Send verification email
 * @param {string} email
 * @param {string} subject
 * @param {string} html
 */
export const sendVerificationEmail = async (email, subject, html) => {
  try {
    await sendEmail({
      to: email,
      subject,
      html,
    });
    logger.info(`✅ Verification email sent to ${email}`);
  } catch (error) {
    logger.error(`❌ Error sending verification email to ${email}:`, error);
    throw new Error('Email could not be sent');
  }
};

/**
 * Send Testimonial Request Email
 * @param {string} giverEmail
 * @param {string} link
 * @param {string} seekerName
 * @param {string} projectDetails
 */
export const sendTestimonialRequestEmail = async (giverEmail, link, seekerName, projectDetails) => {
  try {
    const html = createTestimonialRequestEmailTemplate(link, seekerName, projectDetails);

    await sendEmail({
      to: giverEmail,
      subject: 'Testimonial Request',
      html,
    });

    logger.info(`✅ Testimonial request email sent to ${giverEmail}`);
  } catch (error) {
    logger.error(`❌ Error sending testimonial request email to ${giverEmail}:`, error);
    throw new Error('Testimonial request email could not be sent');
  }
};

/**
 * Send password reset email
 * @param {string} email
 * @param {string} resetUrl
 */
export const sendPasswordResetEmail = async (email, resetUrl) => {
  try {
    const html = createPasswordResetEmailTemplate(resetUrl);

    await sendEmail({
      to: email,
      subject: 'Password Reset Request',
      html,
    });

    logger.info(`✅ Password reset email sent to ${email}`);
  } catch (error) {
    logger.error(`❌ Error sending password reset email to ${email}:`, error);
    throw new Error('Password reset email could not be sent');
  }
};