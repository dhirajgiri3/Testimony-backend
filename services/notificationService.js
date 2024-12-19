// src/services/notificationService.js

import User from '../models/User.js';
import AppError from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import { sendEmail } from '../config/email.js';

/**
 * Send in-app notification
 * @param {string} userId
 * @param {string} message
 */
export const sendInAppNotification = async (userId, message) => {
  try {
    // Assuming you have a notifications collection or a way to send in-app notifications
    // For simplicity, logging the notification
    logger.info(`📩 In-app notification to ${userId}: ${message}`);

    // TODO: Implement actual in-app notification logic, e.g., saving to a notifications collection

    return true;
  } catch (error) {
    logger.error('❌ Error sending in-app notification:', error);
    throw new AppError('Failed to send notification', 500);
  }
};

/**
 * Notify seeker about testimonial approval
 */
export const notifySeekerApproval = async (seekerId, testimonialId, giverEmail) => {
  // Fetch seeker details
  const seeker = await User.findById(seekerId);
  if (!seeker) {
    throw new AppError("Seeker not found", 404);
  }

  const emailContent = `
    Hi ${seeker.firstName},

    Your testimonial from ${giverEmail} has been approved and is now visible on your profile.

    Thank you,
    Testimony Team
  `;

  await sendEmail(seeker.email, "Your Testimonial is Approved", emailContent);
};

/**
 * Notify seeker about testimonial rejection
 */
export const notifySeekerRejection = async (seekerId, testimonialId, giverEmail, comments) => {
  // Fetch seeker details
  const seeker = await User.findById(seekerId);
  if (!seeker) {
    throw new AppError("Seeker not found", 404);
  }

  const emailContent = `
    Hi ${seeker.firstName},

    Your testimonial from ${giverEmail} has been rejected.

    Reason: ${comments}

    You can reach out to support for more details.

    Thank you,
    Testimony Team
  `;

  await sendEmail(seeker.email, "Your Testimonial is Rejected", emailContent);
};

/**
 * Notify seeker about testimonial visibility change
 */
export const notifyVisibilityChange = async (seekerId, testimonialId, isPublic) => {
  // Fetch seeker details
  const seeker = await User.findById(seekerId);
  if (!seeker) {
    throw new AppError("Seeker not found", 404);
  }

  const status = isPublic ? "public" : "private";

  const emailContent = `
    Hi ${seeker.firstName},

    Your testimonial (ID: ${testimonialId}) has been set to ${status}.

    Thank you,
    Testimony Team
  `;

  await sendEmail(seeker.email, "Testimonial Visibility Updated", emailContent);
};

/**
 * Notify giver about sharing of their testimonial
 */
export const notifyGiverShared = async (giverEmail, testimonialId, platform) => {
  const emailContent = `
    Hi,

    Your testimonial (ID: ${testimonialId}) has been shared via ${platform}.

    Thank you for contributing to Testimony!

    Best regards,
    Testimony Team
  `;

  await sendEmail(giverEmail, "Your Testimonial has been Shared", emailContent);
};