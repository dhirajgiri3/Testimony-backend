// src/services/testimonialService.js

import mongoose from 'mongoose';
import Testimonial from '../models/Testimonial.js';
import User from '../models/User.js';
import { queues } from '../jobs/queues.js';
import AppError from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import { nanoid } from 'nanoid';
import { redisClient } from '../config/redis.js';
import { sanitizeInput } from '../utils/validation.js';
import { extractSkills, analyzeSentiment } from './sentimentService.js';
import { sendEmail } from '../config/email.js';
import ActivityLog from '../models/ActivityLog.js';
import { generateRecommendations } from './recommendationService.js';

/**
 * Enhanced Redis caching wrapper
 */
const cache = {
  async get(key) {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.warn(`Cache retrieval failed for key ${key}:`, error);
      return null;
    }
  },

  async set(key, value, expiry = 3600) {
    try {
      await redisClient.setEx(key, expiry, JSON.stringify(value));
    } catch (error) {
      logger.warn(`Cache setting failed for key ${key}:`, error);
    }
  },

  async del(key) {
    try {
      await redisClient.del(key);
    } catch (error) {
      logger.warn(`Cache deletion failed for key ${key}:`, error);
    }
  },
};

/**
 * Transaction wrapper for MongoDB operations.
 *
 * @param {Function} callback - The transactional function.
 * @returns {Promise<any>} - Result of the transactional function.
 */
const withTransaction = async (callback) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Track application metrics.
 *
 * @param {string} name - Metric name.
 * @param {number} value - Metric value.
 * @param {Object} tags - Additional tags for the metric.
 */
const trackMetric = (name, value = 1, tags = {}) => {
  try {
    // Implement your metrics tracking logic here (e.g., Prometheus, Datadog)
    logger.info(`Metric tracked: ${name}`, { value, tags });
  } catch (error) {
    logger.warn(`Failed to track metric ${name}:`, error);
  }
};

/**
 * Create a new testimonial request.
 *
 * @param {string} seekerId - ID of the seeker requesting the testimonial.
 * @param {Array<string>} giverEmails - Emails of the givers.
 * @param {string} projectDetails - Details about the project.
 * @param {Object} additionalData - Additional metadata.
 * @returns {Promise<Object>} - Created testimonial document.
 * @throws {AppError} - If creation fails.
 */
export const createTestimonialRequest = async (
  seekerId,
  giverEmails,
  projectDetails,
  additionalData = {}
) => {
  // Rate limiting can be implemented here if needed.

  // Input sanitization
  const sanitizedEmails = giverEmails.map((email) =>
    sanitizeInput(email.toLowerCase().trim())
  );
  const sanitizedDetails = sanitizeInput(projectDetails);

  return withTransaction(async (session) => {
    const seeker = await User.findById(seekerId).session(session);
    if (!seeker) {
      throw new AppError('Seeker not found.', 404);
    }

    // Validate unique and valid emails
    const uniqueValidEmails = [
      ...new Set(
        sanitizedEmails.filter((email) =>
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        )
      ),
    ];

    if (!uniqueValidEmails.length) {
      throw new AppError('No valid giver emails provided.', 400);
    }

    // Create givers with verification tokens
    const givers = uniqueValidEmails.map((email) => ({
      email,
      verificationToken: nanoid(32),
      verificationTokenExpiry: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      metadata: {
        platform: additionalData.platform || 'web',
        ipAddress: additionalData.ipAddress || 'Unknown',
        userAgent: additionalData.userAgent || 'Unknown',
      },
    }));

    // Create the testimonial
    const testimonial = await Testimonial.create(
      [
        {
          seeker: seekerId,
          givers,
          projectDetails: sanitizedDetails,
          status: 'pending',
          metadata: {
            source: additionalData.source || 'direct',
            totalGivers: uniqueValidEmails.length,
            platform: additionalData.platform || 'web',
            template: additionalData.templateId || 'default',
            createdFrom: {
              ip: additionalData.ipAddress || 'Unknown',
              userAgent: additionalData.userAgent || 'Unknown',
            },
          },
        },
      ],
      { session }
    );

    // Queue email notifications for each giver
    const emailPromises = testimonial[0].givers.map((giver) =>
      queues.emailQueue.add(
        'sendTestimonialRequest',
        {
          to: giver.email,
          seekerName: `${seeker.firstName} ${seeker.lastName}`,
          verificationToken: giver.verificationToken,
          projectDetails: sanitizedDetails,
          testimonialId: testimonial[0]._id,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
        }
      )
    );

    await Promise.allSettled(emailPromises);

    // Track metric
    trackMetric('testimonial.created', 1, {
      seekerId,
      giverCount: uniqueValidEmails.length,
      platform: additionalData.platform || 'web',
    });

    // Invalidate relevant caches
    await cache.del(`seeker_testimonials:${seekerId}`);

    return testimonial[0];
  });
};

/**
 * Submit a testimonial by a giver.
 *
 * @param {string} testimonialId - ID of the testimonial.
 * @param {string} giverToken - Verification token of the giver.
 * @param {Object} submissionData - Data submitted by the giver.
 * @returns {Promise<Object>} - Updated testimonial document.
 * @throws {AppError} - If submission fails.
 */
export const submitTestimonial = async (
  testimonialId,
  giverToken,
  { testimonialText, rating, relationship, skills, media = [] }
) => {
  return withTransaction(async (session) => {
    // Validate input
    if (!testimonialText || typeof testimonialText !== 'string') {
      throw new AppError('Valid testimonial text is required.', 400);
    }

    if (rating && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
      throw new AppError('Rating must be a number between 1 and 5.', 400);
    }

    const testimonial = await Testimonial.findById(testimonialId).session(
      session
    );
    if (!testimonial) {
      throw new AppError('Testimonial not found.', 404);
    }

    const giver = testimonial.givers.find(
      (g) =>
        g.verificationToken === giverToken &&
        g.verificationTokenExpiry > Date.now()
    );

    if (!giver) {
      throw new AppError('Invalid or expired giver token.', 401);
    }

    if (giver.verificationStatus !== 'pending') {
      throw new AppError('Testimonial has already been processed.', 400);
    }

    // Perform AI analysis
    const skillsExtracted = await extractSkills([testimonialText]);
    const sentimentScores = await analyzeSentiment([testimonialText]);
    const sentimentScore = sentimentScores[0] || 0;

    // Update giver details
    giver.testimonial = testimonialText.trim();
    if (rating) giver.rating = rating;
    if (relationship) giver.relationship = relationship;
    if (skills && Array.isArray(skills)) giver.skills = skills;
    giver.media = media;
    giver.isApproved = true;
    giver.verificationStatus = 'approved';
    giver.submittedAt = Date.now();

    // Update testimonial metadata
    testimonial.skills = [
      ...new Set([
        ...(testimonial.skills || []),
        ...skillsExtracted.map((s) => s.skill),
      ]),
    ];
    testimonial.sentimentScore = sentimentScore;
    testimonial.status = testimonial.givers.every((g) => g.testimonial)
      ? 'completed'
      : 'in-progress';
    testimonial.lastUpdated = Date.now();

    await testimonial.save({ session });

    // Queue notification for testimonial submission
    await queues.notificationQueue.add(
      'testimonialSubmitted',
      {
        seekerId: testimonial.seeker,
        testimonialId: testimonial._id,
        giverEmail: giver.email,
      },
      { priority: 2 }
    );

    // Track metric
    trackMetric('testimonial.submitted', 1, {
      seekerId: testimonial.seeker,
      rating,
    });

    // Invalidate relevant caches
    await cache.del(`seeker_testimonials:${testimonial.seeker}`);

    logger.info({
      message: 'Testimonial submitted successfully.',
      testimonialId,
      giverEmail: giver.email,
      status: testimonial.status,
    });

    return testimonial;
  });
};

/**
 * Reject a testimonial giver's submission.
 *
 * @param {string} testimonialId - ID of the testimonial.
 * @param {string} giverId - ID of the giver.
 * @param {string} adminId - ID of the admin performing the rejection.
 * @param {string} comments - Optional comments.
 * @returns {Promise<Object>} - Updated testimonial document.
 * @throws {AppError} - If rejection fails.
 */
export const rejectTestimonial = async (
  testimonialId,
  giverId,
  adminId,
  comments = ''
) => {
  return withTransaction(async (session) => {
    const testimonial = await Testimonial.findById(testimonialId).session(
      session
    );
    if (!testimonial) {
      throw new AppError('Testimonial not found.', 404);
    }

    const giver = testimonial.givers.id(giverId);
    if (!giver) {
      throw new AppError('Giver not found in this testimonial.', 404);
    }

    if (giver.verificationStatus !== 'pending') {
      throw new AppError('Testimonial has already been processed.', 400);
    }

    // Update giver status
    giver.verificationStatus = 'rejected';
    giver.isApproved = false;
    giver.approvalHistory.push({
      status: 'rejected',
      approvedBy: adminId,
      comments,
      approvedAt: Date.now(),
    });

    // Update testimonial status
    testimonial.status = 'reported';

    await testimonial.save({ session });

    // Queue notification for testimonial rejection
    await queues.notificationQueue.add('testimonialRejected', {
      seekerId: testimonial.seeker,
      testimonialId,
      giverEmail: giver.email,
      comments,
    });

    // Track metric
    trackMetric('testimonial.rejected', 1, {
      seekerId: testimonial.seeker,
      adminId,
    });

    // Invalidate relevant caches
    await cache.del(`seeker_testimonials:${testimonial.seeker}`);

    logger.info({
      message: 'Testimonial rejected successfully.',
      testimonialId,
      giverId,
      adminId,
    });

    return testimonial;
  });
};

/**
 * Report a testimonial for inappropriate content or other issues.
 *
 * @param {string} testimonialId - ID of the testimonial.
 * @param {Object} reportData - Data related to the report.
 * @returns {Promise<Object>} - Updated testimonial document.
 * @throws {AppError} - If reporting fails.
 */
export const reportTestimonial = async (testimonialId, reportData) => {
  const {
    reason,
    description,
    evidence = [],
    reportedBy = 'anonymous',
  } = reportData;

  return withTransaction(async (session) => {
    const testimonial = await Testimonial.findById(testimonialId).session(
      session
    );
    if (!testimonial) {
      throw new AppError('Testimonial not found.', 404);
    }

    // Create report entry
    const report = {
      reason: sanitizeInput(reason),
      description: sanitizeInput(description),
      evidence: evidence.map((e) => sanitizeInput(e)),
      reportedBy,
      reportedAt: Date.now(),
      status: 'pending',
    };

    testimonial.reports = testimonial.reports || [];
    testimonial.reports.push(report);
    testimonial.status = 'reported';

    await testimonial.save({ session });

    // Queue notification for admin review
    await queues.notificationQueue.add('testimonialReported', {
      testimonialId,
      reportedBy,
      reason,
      evidenceCount: evidence.length,
    });

    // Track metric
    trackMetric('testimonial.reported', 1, {
      seekerId: testimonial.seeker,
      reportedBy,
    });

    // Invalidate relevant caches
    await cache.del(`seeker_testimonials:${testimonial.seeker}`);

    logger.info({
      message: 'Testimonial reported successfully.',
      testimonialId,
      reportedBy,
      reason,
    });

    return testimonial;
  });
};

/**
 * Archive a testimonial.
 *
 * @param {string} testimonialId - ID of the testimonial to archive.
 * @param {string} userId - ID of the user performing the archiving.
 * @returns {Promise<Object>} - Archived testimonial document.
 * @throws {AppError} - If archiving fails.
 */
export const archiveTestimonial = async (testimonialId, userId) => {
  return withTransaction(async (session) => {
    const testimonial = await Testimonial.findById(testimonialId).session(
      session
    );
    if (!testimonial) {
      throw new AppError('Testimonial not found.', 404);
    }

    testimonial.archived = true;
    testimonial.archivedAt = Date.now();
    testimonial.archivedBy = userId;
    testimonial.archiveReason = sanitizeInput(
      testimonial.archiveReason || 'No reason provided.'
    );

    await testimonial.save({ session });

    // Log the archiving action
    await ActivityLog.create(
      [
        {
          user: userId,
          action: 'TESTIMONIAL_ARCHIVED',
          details: {
            testimonialId,
            reason: testimonial.archiveReason,
          },
        },
      ],
      { session }
    );

    // Track metric
    trackMetric('testimonial.archived', 1, {
      seekerId: testimonial.seeker,
      adminId: userId,
    });

    // Invalidate relevant caches
    await cache.del(`seeker_testimonials:${testimonial.seeker}`);

    logger.info({
      message: 'Testimonial archived successfully.',
      testimonialId,
      userId,
      reason: testimonial.archiveReason,
    });

    return testimonial;
  });
};

/**
 * Restore an archived testimonial.
 *
 * @param {string} testimonialId - ID of the testimonial to restore.
 * @param {string} userId - ID of the user performing the restoration.
 * @returns {Promise<Object>} - Restored testimonial document.
 * @throws {AppError} - If restoration fails.
 */
export const restoreTestimonial = async (testimonialId, userId) => {
  return withTransaction(async (session) => {
    const testimonial = await Testimonial.findById(testimonialId).session(
      session
    );
    if (!testimonial) {
      throw new AppError('Testimonial not found.', 404);
    }

    if (!testimonial.archived) {
      throw new AppError('Testimonial is not archived.', 400);
    }

    testimonial.archived = false;
    testimonial.archivedAt = null;
    testimonial.archivedBy = null;
    testimonial.archiveReason = null;
    testimonial.restoredAt = Date.now();
    testimonial.restoredBy = userId;

    await testimonial.save({ session });

    // Log the restoration action
    await ActivityLog.create(
      [
        {
          user: userId,
          action: 'TESTIMONIAL_RESTORED',
          details: {
            testimonialId,
          },
        },
      ],
      { session }
    );

    // Track metric
    trackMetric('testimonial.restored', 1, {
      seekerId: testimonial.seeker,
      adminId: userId,
    });

    // Invalidate relevant caches
    await cache.del(`seeker_testimonials:${testimonial.seeker}`);

    logger.info({
      message: 'Testimonial restored successfully.',
      testimonialId,
      userId,
    });

    return testimonial;
  });
};

/**
 * Share a testimonial on various platforms.
 *
 * @param {string} testimonialId - ID of the testimonial to share.
 * @param {string} platform - Platform to share on (e.g., twitter, linkedin).
 * @param {Object} options - Additional sharing options.
 * @returns {Promise<Object>} - Details of the shared testimonial.
 * @throws {AppError} - If sharing fails.
 */
export const shareTestimonial = async (
  testimonialId,
  platform,
  options = {}
) => {
  return withTransaction(async (session) => {
    const testimonial = await Testimonial.findById(testimonialId)
      .populate('seeker', 'firstName lastName')
      .session(session);
    if (!testimonial) {
      throw new AppError('Testimonial not found.', 404);
    }

    if (!testimonial.isPublic) {
      throw new AppError('Cannot share private testimonial.', 403);
    }

    // Generate a secure sharing token
    const shareToken = nanoid(32);

    // Create share record
    const share = {
      token: shareToken,
      platform,
      sharedAt: Date.now(),
      expiresAt: options.expiresAt || Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days default
      options,
    };

    testimonial.shares = testimonial.shares || [];
    testimonial.shares.push(share);

    await testimonial.save({ session });

    // Generate sharing URL based on platform
    const shareUrl = generateShareUrl(testimonial, shareToken, platform);

    // Log the sharing action
    await ActivityLog.create(
      [
        {
          user: options.userId || 'system',
          action: 'TESTIMONIAL_SHARED',
          details: {
            testimonialId,
            platform,
            shareToken,
            shareUrl,
          },
        },
      ],
      { session }
    );

    // Track metric
    trackMetric('testimonial.shared', 1, {
      seekerId: testimonial.seeker,
      platform,
    });

    // Queue notification if needed
    if (platform === 'email') {
      queues.emailQueue.add(
        'sendTestimonialShareEmail',
        {
          to: testimonial.seeker.email,
          shareUrl,
          testimonialId,
        },
        { priority: 3 }
      );
    }

    logger.info({
      message: 'Testimonial shared successfully.',
      testimonialId,
      platform,
      shareUrl,
    });

    return {
      shareUrl,
      shareToken,
      expiresAt: share.expiresAt,
    };
  });
};

/**
 * Delete a testimonial with comprehensive data cleanup.
 *
 * @param {string} testimonialId - ID of the testimonial to delete.
 * @param {string} userId - ID of the user requesting deletion.
 * @returns {Promise<Object>} - Confirmation of deletion.
 * @throws {AppError} - If deletion fails.
 */
export const deleteTestimonial = async (testimonialId, userId) => {
  return withTransaction(async (session) => {
    const testimonial = await Testimonial.findById(testimonialId).session(
      session
    );
    if (!testimonial) {
      throw new AppError('Testimonial not found.', 404);
    }

    // Verify user permissions
    if (testimonial.seeker.toString() !== userId) {
      throw new AppError('Unauthorized to delete this testimonial.', 403);
    }

    // Check testimonial status
    if (testimonial.status === 'completed') {
      throw new AppError('Cannot delete a completed testimonial.', 400);
    }

    // Remove associated data if any (e.g., certificates)
    if (testimonial.certificates && testimonial.certificates.length > 0) {
      // Implement certificate deletion logic if certificates are stored externally
      // Example: Delete from AWS S3 or another storage service
      testimonial.certificates.forEach((cert) => {
        queues.exportQueue.add(
          'deleteCertificate',
          { url: cert.url },
          { removeOnComplete: true }
        );
      });
    }

    // Remove the testimonial
    await testimonial.remove({ session });

    // Log the deletion
    await ActivityLog.create(
      [
        {
          user: userId,
          action: 'TESTIMONIAL_DELETED',
          details: {
            testimonialId,
            timestamp: Date.now(),
          },
        },
      ],
      { session }
    );

    // Track metric
    trackMetric('testimonial.deleted', 1, {
      seekerId: testimonial.seeker,
      userId,
    });

    // Invalidate relevant caches
    await cache.del(`seeker_testimonials:${testimonial.seeker}`);

    logger.info({
      message: 'Testimonial deleted successfully.',
      testimonialId,
      userId,
    });

    return {
      message: 'Testimonial deleted successfully.',
      testimonialId,
    };
  });
};

/**
 * Helper function to generate sharing URLs based on platform.
 *
 * @param {Object} testimonial - The testimonial document.
 * @param {string} token - The sharing token.
 * @param {string} platform - The platform to share on.
 * @returns {string} - The generated sharing URL.
 */
const generateShareUrl = (testimonial, token, platform) => {
  const baseUrl = process.env.CLIENT_URL;
  const sharePath = `/testimonials/share/${token}`;
  const shareUrl = `${baseUrl}${sharePath}`;

  switch (platform.toLowerCase()) {
    case 'twitter':
      return `https://twitter.com/intent/tweet?url=${encodeURIComponent(
        shareUrl
      )}&text=${encodeURIComponent(`Check out this testimonial: ${shareUrl}`)}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
        shareUrl
      )}`;
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        shareUrl
      )}`;
    case 'email':
      return shareUrl;
    default:
      return shareUrl;
  }
};

/**
 * Enqueue analytics update job.
 *
 * @param {string} seekerId - ID of the seeker.
 * @returns {Promise<void>}
 */
export const enqueueAnalyticsUpdate = async (seekerId) => {
  await queues.analyticsQueue.add(
    'updateAnalytics',
    { seekerId },
    { priority: 2, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );
};

/**
 * Retrieve testimonials with pagination and filtering.
 *
 * @param {Object} options - Pagination and sorting options.
 * @param {number} options.page - Current page number.
 * @param {number} options.limit - Number of testimonials per page.
 * @param {Object} filters - Filtering criteria.
 * @param {string} [filters.seekerId] - ID of the seeker.
 * @param {string} [filters.status] - Status of the testimonial.
 * @param {boolean} [filters.isPublic] - Public visibility of the testimonial.
 * @returns {Promise<Object>} - Paginated testimonials data.
 * @throws {AppError} - If retrieval fails.
 */
export const getTestimonials = async (options, filters) => {
  const {
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    order = 'desc',
  } = options;
  const skip = (page - 1) * limit;

  const query = {};

  if (filters.seekerId) {
    query.seeker = filters.seekerId;
  }

  if (filters.status) {
    query.status = filters.status;
  }

  if (typeof filters.isPublic === 'boolean') {
    query.isPublic = filters.isPublic;
  }

  try {
    const [total, testimonials] = await Promise.all([
      Testimonial.countDocuments(query),
      Testimonial.find(query)
        .sort({ [sortBy]: order === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .populate('seeker', 'firstName lastName')
        .exec(),
    ]);

    return {
      total,
      page,
      limit,
      testimonials,
    };
  } catch (error) {
    logger.error('Error retrieving testimonials:', error);
    throw new AppError('Failed to retrieve testimonials.', 500);
  }
};

/**
 * Export testimonials as a CSV file.
 *
 * @param {Object} filters - Filtering criteria for export.
 * @param {string} [filters.seekerId] - ID of the seeker.
 * @param {string} [filters.status] - Status of the testimonial.
 * @param {boolean} [filters.isPublic] - Public visibility of the testimonial.
 * @returns {Promise<string>} - CSV formatted string of testimonials.
 * @throws {AppError} - If export fails.
 */
export const exportTestimonials = async (filters) => {
  const query = {};

  if (filters.seekerId) {
    query.seeker = filters.seekerId;
  }

  if (filters.status) {
    query.status = filters.status;
  }

  if (typeof filters.isPublic === 'boolean') {
    query.isPublic = filters.isPublic;
  }

  try {
    const testimonials = await Testimonial.find(query)
      .populate('seeker', 'firstName lastName email')
      .exec();

    const csvHeaders = [
      'Testimonial ID',
      'Seeker Name',
      'Seeker Email',
      'Status',
      'Created At',
      'Last Updated',
    ];

    const csvRows = testimonials.map((t) => [
      t._id,
      `${t.seeker.firstName} ${t.seeker.lastName}`,
      t.seeker.email,
      t.status,
      t.createdAt.toISOString(),
      t.lastUpdated.toISOString(),
    ]);

    const csvContent = [csvHeaders, ...csvRows]
      .map((row) => row.join(','))
      .join('\n');

    logger.info(`Exported ${testimonials.length} testimonials as CSV.`);
    return csvContent;
  } catch (error) {
    logger.error('Error exporting testimonials:', error);
    throw new AppError('Failed to export testimonials.', 500);
  }
};

/**
 * Search testimonials based on a query string.
 *
 * @param {string} queryStr - The search query.
 * @param {Object} options - Pagination and sorting options.
 * @param {number} options.page - Current page number.
 * @param {number} options.limit - Number of testimonials per page.
 * @returns {Promise<Object>} - Paginated search results.
 * @throws {AppError} - If search fails.
 */
export const searchTestimonials = async (queryStr, options) => {
  const {
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    order = 'desc',
  } = options;
  const skip = (page - 1) * limit;

  try {
    const regex = new RegExp(queryStr, 'i');
    const query = {
      $or: [
        { 'seeker.firstName': regex },
        { 'seeker.lastName': regex },
        { projectDetails: regex },
        { 'givers.email': regex },
      ],
    };

    const [total, testimonials] = await Promise.all([
      Testimonial.countDocuments(query),
      Testimonial.find(query)
        .sort({ [sortBy]: order === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .populate('seeker', 'firstName lastName')
        .exec(),
    ]);

    return {
      total,
      page,
      limit,
      testimonials,
    };
  } catch (error) {
    logger.error('Error searching testimonials:', error);
    throw new AppError('Failed to search testimonials.', 500);
  }
};

/**
 * Generate and send personalized recommendations to the seeker.
 *
 * @param {string} seekerId - ID of the seeker.
 * @returns {Promise<void>}
 */
export const sendPersonalizedRecommendations = async (seekerId) => {
  const seeker = await User.findById(seekerId);
  if (!seeker) {
    throw new AppError('Seeker not found.', 404);
  }

  const analyticsData = await getAnalyticsForSeeker(seekerId);
  const recommendations = await generateRecommendations(analyticsData);

  await sendEmail({
    to: seeker.email,
    subject: 'Your Personalized Recommendations',
    html: recommendations,
  });

  logger.info(`Sent personalized recommendations to seeker ${seekerId}`);
};

/**
 * Retrieve analytics data for a seeker.
 *
 * @param {string} seekerId - ID of the seeker.
 * @returns {Promise<Object>} - Analytics data.
 */
const getAnalyticsForSeeker = async (seekerId) => {
  // Implement the logic to gather analytics data for the seeker
  // This might include fetching user activity, testimonials, engagement metrics, etc.
  const analytics = {
    // Example analytics data
    activity: await getUserActivity(seekerId),
    testimonials: await Testimonial.find({ seeker: seekerId }),
    // Add more relevant analytics as needed
  };
  return analytics;
};

// Modify approveTestimonial to send recommendations after approval
export const approveTestimonial = async (
  testimonialId,
  giverId,
  adminId,
  comments = ''
) => {
  const testimonial = await withTransaction(async (session) => {
    const testimonial = await Testimonial.findById(testimonialId).session(session);
    if (!testimonial) {
      throw new AppError('Testimonial not found.', 404);
    }

    const giver = testimonial.givers.id(giverId);
    if (!giver) {
      throw new AppError('Giver not found in this testimonial.', 404);
    }

    if (giver.verificationStatus !== 'pending') {
      throw new AppError('Testimonial has already been processed.', 400);
    }

    // Update giver status
    giver.verificationStatus = 'approved';
    giver.isApproved = true;
    giver.approvalHistory.push({
      status: 'approved',
      approvedBy: adminId,
      comments,
      approvedAt: Date.now(),
    });

    // Check if all givers are approved
    const allApproved = testimonial.givers.every(
      (g) => g.verificationStatus === 'approved'
    );
    if (allApproved) {
      testimonial.status = 'completed';
      // Send personalized recommendations when all givers are approved
      await sendPersonalizedRecommendations(testimonial.seeker);
    }

    await testimonial.save({ session });

    // Queue notification for testimonial approval
    await queues.notificationQueue.add('testimonialApproved', {
      seekerId: testimonial.seeker,
      testimonialId,
      giverEmail: giver.email,
    });

    // Track metric
    trackMetric('testimonial.approved', 1, {
      seekerId: testimonial.seeker,
      adminId,
    });

    // Invalidate relevant caches
    await cache.del(`seeker_testimonials:${testimonial.seeker}`);

    logger.info({
      message: 'Testimonial approved successfully.',
      testimonialId,
      giverId,
      adminId,
    });

    return testimonial;
  });

  return testimonial;
};

/**
 * Retrieve testimonials for a specific seeker with advanced filtering and pagination options.
 *
 * @param {string} seekerId - ID of the seeker.
 * @param {Object} filters - Filtering criteria.
 * @param {string} [filters.status] - Status of the testimonial.
 * @param {string} [filters.search] - Search term.
 * @param {string} [filters.startDate] - Start date for filtering.
 * @param {string} [filters.endDate] - End date for filtering.
 * @param {string} [filters.category] - Category of the testimonial.
 * @param {number} [filters.rating] - Rating of the testimonial.
 * @param {boolean} [filters.isPublic] - Public visibility of the testimonial.
 * @param {Object} options - Pagination and sorting options.
 * @param {number} [options.page=1] - Current page number.
 * @param {number} [options.limit=10] - Number of testimonials per page.
 * @param {string} [options.sortBy='createdAt'] - Field to sort by.
 * @param {string} [options.order='desc'] - Sort order ('asc' or 'desc').
 * @returns {Promise<Object>} - Paginated testimonials data with statistics.
 * @throws {AppError} - If retrieval fails.
 */
export const getTestimonialsForSeeker = async (
  seekerId,
  filters = {},
  options = {}
) => {
  try {
    const { status, search, startDate, endDate, category, rating, isPublic } =
      filters;

    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      order = 'desc',
    } = options;

    // Build query
    const query = { seeker: seekerId };

    // Apply filters
    if (status) query.status = status;
    if (category) query['givers.projectCategory'] = category;
    if (typeof isPublic === 'boolean') query.isPublic = isPublic;
    if (rating) query['givers.rating'] = rating;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (search) {
      query.$or = [
        { 'givers.testimonial': { $regex: search, $options: 'i' } },
        { projectDetails: { $regex: search, $options: 'i' } },
        { 'givers.skills': { $in: [new RegExp(search, 'i')] } },
      ];
    }

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const sortOption = { [sortBy]: order === 'desc' ? -1 : 1 };

    const [testimonials, total] = await Promise.all([
      Testimonial.find(query)
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .populate('seeker', 'firstName lastName email')
        .lean(),
      Testimonial.countDocuments(query),
    ]);

    // Calculate statistics
    const stats = {
      total,
      approved: await Testimonial.countDocuments({
        ...query,
        status: 'completed',
      }),
      pending: await Testimonial.countDocuments({
        ...query,
        status: 'pending',
      }),
      averageRating:
        testimonials.reduce((acc, t) => {
          const ratings = t.givers.map((g) => g.rating).filter(Boolean);
          return ratings.length
            ? acc + ratings.reduce((a, b) => a + b, 0) / ratings.length
            : acc;
        }, 0) / (testimonials.length || 1),
    };

    return {
      testimonials,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit,
      },
      stats,
    };
  } catch (error) {
    logger.error('Error fetching testimonials:', error);
    throw error instanceof AppError
      ? error
      : new AppError('Failed to fetch testimonials', 500);
  }
};

export default {
  createTestimonialRequest,
  submitTestimonial,
  approveTestimonial,
  rejectTestimonial,
  reportTestimonial,
  archiveTestimonial,
  restoreTestimonial,
  shareTestimonial,
  deleteTestimonial,
  enqueueAnalyticsUpdate,
  getTestimonials,
  exportTestimonials,
  searchTestimonials,
  sendPersonalizedRecommendations,
  getTestimonialsForSeeker,
};