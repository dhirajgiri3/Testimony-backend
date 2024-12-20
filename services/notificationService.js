// src/services/notificationService.js

import User from '../models/User.js';
import AppError from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import { queues } from '../jobs/queues.js'; // Import BullMQ queues
import { sanitizeInput } from '../utils/sanitize.js'; // Utility for input sanitization

/**
 * Sends an in-app notification to a user via a background job.
 *
 * @param {string} userId - The user's ID.
 * @param {string} message - The notification message.
 * @param {Object} [options] - Additional options for the notification.
 * @returns {Promise<void>}
 */
export const sendInAppNotification = async (userId, message, options = {}) => {
  try {
    // Fetch user preferences
    const user = await User.findById(userId).select('notificationPreferences');
    if (user && !user.notificationPreferences.inApp.testimonialApproval) {
      // Skip sending in-app notification
      logger.info(
        `🔔 In-app notification skipped for User ${userId} due to preferences`
      );
      return;
    }

    // Sanitize inputs
    const sanitizedMessage = sanitizeInput(message);

    // Enqueue the notification job
    await queues.notificationQueue.add(
      'sendInAppNotification',
      {
        userId,
        message: sanitizedMessage,
        ...options,
      },
      {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000, // Start with 5 seconds
        },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    logger.info(`🔔 In-app notification job enqueued for User ${userId}`);
  } catch (error) {
    logger.error('❌ Failed to enqueue in-app notification:', error);
    throw new AppError('Failed to send in-app notification', 500);
  }
};

/**
 * Sends an email notification to a user via a background job.
 *
 * @param {string} email - The user's email address.
 * @param {string} subject - Email subject.
 * @param {string} template - Template name for the email.
 * @param {Object} [data={}] - Data to populate the email template.
 * @returns {Promise<void>}
 */
export const sendEmailNotification = async (
  userId,
  email,
  subject,
  template,
  data = {}
) => {
  try {
    // Fetch user preferences
    const user = await User.findById(userId).select('notificationPreferences');
    if (user && !user.notificationPreferences.email.testimonialApproval) {
      // Skip sending email
      logger.info(
        `📧 Email notification skipped for User ${userId} due to preferences`
      );
      return;
    }

    // Sanitize inputs
    const sanitizedEmail = sanitizeInput(email);
    const sanitizedSubject = sanitizeInput(subject);
    const sanitizedTemplate = sanitizeInput(template);

    // Enqueue the email job
    await queues.emailQueue.add(
      'sendEmailNotification',
      {
        to: sanitizedEmail,
        subject: sanitizedSubject,
        template: sanitizedTemplate,
        data,
      },
      {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000, // Start with 5 seconds
        },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    logger.info(`📧 Email notification job enqueued for ${sanitizedEmail}`);
  } catch (error) {
    logger.error('❌ Failed to enqueue email notification:', error);
    throw new AppError('Failed to send email notification', 500);
  }
};

/**
 * Notifies the seeker about testimonial approval.
 *
 * @param {string} seekerId - The seeker's user ID.
 * @param {string} testimonialId - The testimonial ID.
 * @param {string} giverEmail - The giver's email address.
 * @returns {Promise<void>}
 */
export const notifySeekerApproval = async (
  seekerId,
  testimonialId,
  giverEmail
) => {
  try {
    const seeker = await User.findById(seekerId);
    if (!seeker) {
      throw new AppError('Seeker not found', 404);
    }

    const subject = 'Your Testimonial Has Been Approved';
    const template = 'testimonialApprovalEmail'; // Corresponds to 'testimonialApprovalEmail.hbs'
    const data = {
      firstName: seeker.firstName,
      giverEmail,
      testimonialId,
      profileLink: `${process.env.FRONTEND_URL}/profile/${seeker.username}`,
    };

    // Enqueue the email notification
    await sendEmailNotification(
      seekerId,
      seeker.email,
      subject,
      template,
      data
    );

    // Enqueue the in-app notification
    await sendInAppNotification(
      seekerId,
      'Your testimonial has been approved.'
    );

    logger.info(`✅ Seeker notified about testimonial approval: ${seekerId}`);
  } catch (error) {
    logger.error(
      '❌ Failed to notify seeker about testimonial approval:',
      error
    );
    throw new AppError(
      'Failed to notify seeker about testimonial approval',
      500
    );
  }
};

/**
 * Notifies the seeker about testimonial rejection.
 *
 * @param {string} seekerId - The seeker's user ID.
 * @param {string} testimonialId - The testimonial ID.
 * @param {string} giverEmail - The giver's email address.
 * @param {string} comments - Comments for rejection.
 * @returns {Promise<void>}
 */
export const notifySeekerRejection = async (
  seekerId,
  testimonialId,
  giverEmail,
  comments
) => {
  try {
    const seeker = await User.findById(seekerId);
    if (!seeker) {
      throw new AppError('Seeker not found', 404);
    }

    const subject = 'Your Testimonial Has Been Rejected';
    const template = 'testimonialRejectionEmail'; // Corresponds to 'testimonialRejectionEmail.hbs'
    const data = {
      firstName: seeker.firstName,
      giverEmail,
      testimonialId,
      comments,
      supportLink: `${process.env.FRONTEND_URL}/support`,
    };

    // Enqueue the email notification
    await sendEmailNotification(
      seekerId,
      seeker.email,
      subject,
      template,
      data
    );

    // Enqueue the in-app notification
    await sendInAppNotification(
      seekerId,
      'Your testimonial has been rejected.'
    );

    logger.info(`✅ Seeker notified about testimonial rejection: ${seekerId}`);
  } catch (error) {
    logger.error(
      '❌ Failed to notify seeker about testimonial rejection:',
      error
    );
    throw new AppError(
      'Failed to notify seeker about testimonial rejection',
      500
    );
  }
};

/**
 * Notifies the seeker about testimonial visibility changes.
 *
 * @param {string} seekerId - The seeker's user ID.
 * @param {string} testimonialId - The testimonial ID.
 * @param {boolean} isPublic - Visibility status.
 * @returns {Promise<void>}
 */
export const notifyVisibilityChange = async (
  seekerId,
  testimonialId,
  isPublic
) => {
  try {
    const seeker = await User.findById(seekerId);
    if (!seeker) {
      throw new AppError('Seeker not found', 404);
    }

    const status = isPublic ? 'public' : 'private';
    const subject = 'Testimonial Visibility Updated';
    const template = 'testimonialVisibilityChangeEmail'; // Corresponds to 'testimonialVisibilityChangeEmail.hbs'
    const data = {
      firstName: seeker.firstName,
      testimonialId,
      status,
      profileLink: `${process.env.FRONTEND_URL}/profile/${seeker.username}`,
    };

    // Enqueue the email notification
    await sendEmailNotification(
      seekerId,
      seeker.email,
      subject,
      template,
      data
    );

    // Enqueue the in-app notification
    await sendInAppNotification(
      seekerId,
      `Your testimonial has been set to ${status}.`
    );

    logger.info(
      `✅ Seeker notified about testimonial visibility change: ${seekerId}`
    );
  } catch (error) {
    logger.error('❌ Failed to notify seeker about visibility change:', error);
    throw new AppError('Failed to notify seeker about visibility change', 500);
  }
};

/**
 * Notifies the giver about the sharing of their testimonial.
 *
 * @param {string} giverEmail - The giver's email address.
 * @param {string} testimonialId - The testimonial ID.
 * @param {string} platform - The platform where the testimonial was shared.
 * @returns {Promise<void>}
 */
export const notifyGiverShared = async (
  giverEmail,
  testimonialId,
  platform
) => {
  try {
    const subject = 'Your Testimonial Has Been Shared';
    const template = 'testimonialSharedEmail'; // Corresponds to 'testimonialSharedEmail.hbs'
    const data = {
      testimonialId,
      platform,
      thankYouMessage: 'Thank you for contributing to Testimony!',
    };

    // Enqueue the email notification
    await sendEmailNotification(null, giverEmail, subject, template, data);

    logger.info(`✅ Giver notified about testimonial sharing: ${giverEmail}`);
  } catch (error) {
    logger.error('❌ Failed to notify giver about testimonial sharing:', error);
    throw new AppError('Failed to notify giver about testimonial sharing', 500);
  }
};

/**
 * Notifies the admin about escalation events.
 *
 * @param {string} adminId - The admin's user ID.
 * @param {string} event - The escalation event type.
 * @param {Object} details - Additional details about the event.
 * @returns {Promise<void>}
 */
export const notifyAdminEscalation = async (adminId, event, details) => {
  try {
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      throw new AppError('Admin user not found or unauthorized', 404);
    }

    const subject = `Escalation Alert: ${event}`;
    const template = 'escalationAlertEmail'; // Corresponds to 'escalationAlertEmail.hbs'
    const data = {
      adminName: admin.firstName,
      event,
      details,
      supportLink: `${process.env.FRONTEND_URL}/support`,
    };

    // Enqueue the email notification
    await sendEmailNotification(adminId, admin.email, subject, template, data);

    // Enqueue the in-app notification
    await sendInAppNotification(adminId, `Escalation Alert: ${event}`);

    logger.info(`✅ Admin notified about escalation: ${event}`);
  } catch (error) {
    logger.error('❌ Failed to notify admin about escalation:', error);
    throw new AppError('Failed to notify admin about escalation', 500);
  }
};

const notificationService = {
  sendInAppNotification,
  sendEmailNotification,
  notifySeekerApproval,
  notifySeekerRejection,
  notifyVisibilityChange,
  notifyGiverShared,
  notifyAdminEscalation,
};

export default notificationService;
