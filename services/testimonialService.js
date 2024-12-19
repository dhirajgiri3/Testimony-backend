// src/services/testimonialService.js

import mongoose from 'mongoose';
import Testimonial from "../models/Testimonial.js";
import User from "../models/User.js";
import {queues} from "../jobs/queues.js";
import AppError from "../utils/appError.js";
import { logger } from "../utils/logger.js";
import { nanoid } from "nanoid";
import {redis} from '../config/redis.js';
import { sanitizeInput } from '../utils/validation.js';
import { 
  extractSkills, 
  analyzeDetailedSentiment, 
  analyzeEmotions, 
  processTestimonialText,
  generateTestimonialSuggestions
} from "./aiService.js";
import { sendEmail } from '../config/email.js';
import metrics from '../utils/metrics.js';

// Enhanced Redis caching wrapper
const cache = {
  async get(key) {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.warn(`Cache retrieval failed for key ${key}:`, error);
      return null;
    }
  },

  async set(key, value, expiry = 3600) {
    try {
      await redis.setex(key, expiry, JSON.stringify(value));
    } catch (error) {
      logger.warn(`Cache setting failed for key ${key}:`, error);
    }
  },

  async del(key) {
    try {
      await redis.del(key);
    } catch (error) {
      logger.warn(`Cache deletion failed for key ${key}:`, error);
    }
  }
};

// Enhanced transaction wrapper
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

// Metrics tracking
const trackMetric = (name, value = 1, tags = {}) => {
  try {
    metrics.increment(name, value, tags);
  } catch (error) {
    logger.warn(`Failed to track metric ${name}:`, error);
  }
};

/**
 * Create a new testimonial request with enhanced validation and security
 */
export const createTestimonialRequest = async (seekerId, giverEmails, projectDetails, additionalData = {}) => {
  // Rate limiting check
  await rateLimiter.checkLimit(`testimonial_create:${seekerId}`, RATE_LIMITS.TESTIMONIAL_CREATE);

  // Input sanitization
  const sanitizedEmails = giverEmails.map(email => sanitizeInput(email.toLowerCase().trim()));
  const sanitizedDetails = sanitizeInput(projectDetails);

  return withTransaction(async (session) => {
    const seeker = await User.findById(seekerId).session(session);
    if (!seeker) {
      throw new AppError(ERROR_MESSAGES.SEEKER_NOT_FOUND, 404);
    }

    // Validate unique emails
    const uniqueEmails = [...new Set(sanitizedEmails.filter(email => 
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ))];

    if (!uniqueEmails.length) {
      throw new AppError(ERROR_MESSAGES.NO_VALID_EMAILS, 400);
    }

    // Create givers with enhanced verification
    const givers = uniqueEmails.map(email => ({
      email,
      verificationToken: nanoid(32),
      verificationTokenExpiry: Date.now() + 24 * 60 * 60 * 1000,
      metadata: {
        platform: additionalData.platform || 'web',
        ipAddress: additionalData.ipAddress,
        userAgent: additionalData.userAgent
      }
    }));

    // Create testimonial with improved structure
    const testimonial = await Testimonial.create([{
      seeker: seekerId,
      givers,
      projectDetails: sanitizedDetails,
      status: TESTIMONIAL_STATUS.PENDING,
      metadata: {
        source: additionalData.source || 'direct',
        totalGivers: uniqueEmails.length,
        platform: additionalData.platform || 'web',
        template: additionalData.templateId,
        createdFrom: {
          ip: additionalData.ipAddress,
          userAgent: additionalData.userAgent
        }
      }
    }], { session });

    // Queue email notifications with enhanced error handling
    const emailPromises = testimonial[0].givers.map(giver => 
      queues.emailQueue.add(
        'sendTestimonialRequest',
        {
          to: giver.email,
          seekerName: `${seeker.firstName} ${seeker.lastName}`,
          verificationToken: giver.verificationToken,
          projectDetails: sanitizedDetails,
          testimonialId: testimonial[0]._id
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 0
          },
          removeOnComplete: true
        }
      )
    );

    await Promise.allSettled(emailPromises);

    // Track metrics
    trackMetric('testimonial.created', 1, {
      seekerId,
      giverCount: uniqueEmails.length,
      platform: additionalData.platform
    });

    // Clear relevant caches
    await cache.del(`seeker_testimonials:${seekerId}`);

    return testimonial[0];
  });
};

/**
 * Submit Testimonial with transactional support and enhanced AI analysis
 */
export const submitTestimonial = async (
  testimonialId,
  giverToken,
  { testimonialText, rating, relationship, skills, media = [] }
) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Enhanced input validation
    if (typeof testimonialText !== 'string' || !testimonialText.trim()) {
      throw new AppError("Valid testimonial text is required", 400);
    }

    if (rating && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
      throw new AppError("Rating must be a number between 1 and 5", 400);
    }

    const testimonial = await Testimonial.findById(testimonialId).session(session);
    if (!testimonial) {
      throw new AppError("Testimonial request not found", 404);
    }

    const giver = testimonial.givers.find(
      (g) => g.verificationToken === giverToken && 
      g.verificationTokenExpiry > Date.now()
    );

    if (!giver) {
      throw new AppError("Invalid or expired giver token", 401);
    }

    if (giver.verificationStatus !== "pending") {
      throw new AppError(
        `Testimonial has already been ${giver.verificationStatus}`, 
        400
      );
    }

    // Parallel AI analysis with timeout and retry logic
    const aiAnalysisPromises = [
      extractSkills(testimonialText),
      analyzeSentiment(testimonialText),
      analyzeEmotions(testimonialText),
      categorizeProject(testimonial.projectDetails)
    ].map(promise => 
      Promise.race([
        promise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AI Analysis timeout')), AI_TIMEOUT)
        )
      ])
    );

    let [skillsExtracted, sentimentScore, emotionAnalysis, categories] = await Promise.allSettled(aiAnalysisPromises)
      .then(results => results.map(result => result.status === 'fulfilled' ? result.value : null));

    // Fallback values if AI analysis fails
    skillsExtracted = skillsExtracted || [];
    sentimentScore = sentimentScore || 0;
    emotionAnalysis = emotionAnalysis || {};
    categories = categories || [];

    // Update giver details
    giver.testimonial = testimonialText.trim();
    if (rating) giver.rating = rating;
    if (relationship) giver.relationship = relationship;
    if (skills) giver.skills = skills;
    giver.media = media;
    giver.isApproved = true;
    giver.verificationStatus = "approved";
    giver.submittedAt = Date.now();

    // Update testimonial metadata
    testimonial.skills = [...new Set([...testimonial.skills, ...skillsExtracted])];
    testimonial.sentimentScore = sentimentScore;
    testimonial.emotionAnalysis = {
      ...testimonial.emotionAnalysis,
      ...emotionAnalysis
    };
    testimonial.categories = [...new Set([...testimonial.categories, ...categories])];
    testimonial.status = testimonial.givers.every(g => g.testimonial) ? "completed" : "in-progress";
    testimonial.lastUpdated = Date.now();

    // Process the testimonial text
    const analysis = await processTestimonialText(testimonialText);
    // Assign analysis results to testimonial
    testimonial.analysis = analysis;

    await testimonial.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Trigger notification for testimonial submission
    queues.notificationQueue.add(
      "testimonialSubmitted",
      {
        seekerId: testimonial.seeker,
        testimonialId: testimonial._id,
        giverEmail: giver.email
      },
      { priority: 2 }
    );

    logger.info({
      message: "Testimonial submitted successfully",
      testimonialId,
      giverEmail: giver.email,
      status: testimonial.status
    });

    return testimonial;

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error({
      message: "Failed to submit testimonial",
      testimonialId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Approve a testimonial giver's submission
 */
export const approveTestimonial = async (testimonialId, giverId, adminId, comments = "") => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const testimonial = await Testimonial.findById(testimonialId).session(session);
    if (!testimonial) {
      throw new AppError("Testimonial not found", 404);
    }

    const giver = testimonial.givers.id(giverId);
    if (!giver) {
      throw new AppError("Giver not found in this testimonial", 404);
    }

    if (giver.verificationStatus !== "pending") {
      throw new AppError("Testimonial has already been processed", 400);
    }

    giver.verificationStatus = "approved";
    giver.isApproved = true;
    giver.submittedAt = Date.now();
    giver.approvalHistory.push({
      status: "approved",
      approvedBy: adminId,
      comments,
      approvedAt: Date.now()
    });

    // Update overall testimonial status if all givers are approved
    const allApproved = testimonial.givers.every(g => g.verificationStatus === "approved");
    if (allApproved) {
      testimonial.status = "completed";
    }

    await testimonial.save({ session });

    // Notify seeker about approval
    queues.notificationQueue.add("testimonialApproved", {
      seekerId: testimonial.seeker,
      testimonialId,
      giverEmail: giver.email,
    });

    await session.commitTransaction();
    session.endSession();

    logger.info({
      message: "Testimonial approved successfully",
      testimonialId,
      giverId,
      adminId
    });

    return testimonial;

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error({
      message: "Failed to approve testimonial",
      testimonialId,
      giverId,
      adminId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Reject a testimonial giver's submission
 */
export const rejectTestimonial = async (testimonialId, giverId, adminId, comments = "") => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const testimonial = await Testimonial.findById(testimonialId).session(session);
    if (!testimonial) {
      throw new AppError("Testimonial not found", 404);
    }

    const giver = testimonial.givers.id(giverId);
    if (!giver) {
      throw new AppError("Giver not found in this testimonial", 404);
    }

    if (giver.verificationStatus !== "pending") {
      throw new AppError("Testimonial has already been processed", 400);
    }

    giver.verificationStatus = "rejected";
    giver.isApproved = false;
    giver.approvalHistory.push({
      status: "rejected",
      approvedBy: adminId,
      comments,
      approvedAt: Date.now()
    });

    // Update overall testimonial status if any giver is rejected
    testimonial.status = "reported";

    await testimonial.save({ session });

    // Notify seeker about rejection
    queues.notificationQueue.add("testimonialRejected", {
      seekerId: testimonial.seeker,
      testimonialId,
      giverEmail: giver.email,
      comments,
    });

    await session.commitTransaction();
    session.endSession();

    logger.info({
      message: "Testimonial rejected successfully",
      testimonialId,
      giverId,
      adminId
    });

    return testimonial;

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error({
      message: "Failed to reject testimonial",
      testimonialId,
      giverId,
      adminId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Bulk process testimonials (Approve or Reject)
 */
export const bulkProcessTestimonials = async (testimonialIds, { action, reason, adminId }) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const testimonials = await Testimonial.find({ _id: { $in: testimonialIds } }).session(session);
    
    for (const testimonial of testimonials) {
      for (const giver of testimonial.givers) {
        if (giver.verificationStatus === "pending") {
          if (action === "approve") {
            giver.verificationStatus = "approved";
            giver.isApproved = true;
            giver.approvalHistory.push({
              status: "approved",
              approvedBy: adminId,
              comments: reason,
              approvedAt: Date.now()
            });
          } else if (action === "reject") {
            giver.verificationStatus = "rejected";
            giver.isApproved = false;
            giver.approvalHistory.push({
              status: "rejected",
              approvedBy: adminId,
              comments: reason,
              approvedAt: Date.now()
            });
          }
        }
      }

      // Update testimonial status
      if (action === "approve") {
        const allApproved = testimonial.givers.every(g => g.verificationStatus === "approved");
        if (allApproved) {
          testimonial.status = "completed";
        }
      } else if (action === "reject") {
        testimonial.status = "reported";
      }

      await testimonial.save({ session });

      // Notify seeker
      queues.notificationQueue.add(action === "approve" ? "testimonialApproved" : "testimonialRejected", {
        seekerId: testimonial.seeker,
        testimonialId: testimonial._id,
        giverEmails: testimonial.givers.map(g => g.email),
        comments: reason
      });
    }

    await session.commitTransaction();
    session.endSession();

    logger.info({
      message: `Bulk ${action} completed successfully`,
      testimonialIds,
      adminId
    });

    return { message: `Bulk ${action} completed successfully` };

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error({
      message: `Failed to bulk ${action} testimonials`,
      testimonialIds,
      adminId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Get testimonial statistics with insights
 * @param {string} seekerId
 * @returns {Promise<Object>}
 */
export const getTestimonialStats = async (seekerId) => {
  try {
    const stats = await Testimonial.aggregate([
      { $match: { seeker: mongoose.Types.ObjectId(seekerId) } },
      {
        $facet: {
          overview: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                approved: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "completed"] }, 1, 0]
                  }
                },
                pending: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "pending"] }, 1, 0]
                  }
                },
                avgSentiment: { $avg: "$sentimentScore" },
                totalGivers: { $sum: { $size: "$givers" } }
              }
            }
          ],
          categoryDistribution: [
            { $unwind: "$categories" },
            {
              $group: {
                _id: "$categories",
                count: { $sum: 1 }
              }
            },
            { $sort: { count: -1 } }
          ],
          monthlyTrend: [
            {
              $group: {
                _id: {
                  year: { $year: "$createdAt" },
                  month: { $month: "$createdAt" }
                },
                count: { $sum: 1 },
                avgSentiment: { $avg: "$sentimentScore" }
              }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } }
          ]
        }
      }
    ]);

    return {
      overview: stats[0].overview[0] || {
        total: 0,
        approved: 0,
        pending: 0,
        avgSentiment: 0,
        totalGivers: 0
      },
      categoryDistribution: stats[0].categoryDistribution,
      monthlyTrend: stats[0].monthlyTrend
    };
  } catch (error) {
    logger.error('Error getting testimonial stats:', error);
    throw new AppError('Failed to fetch testimonial statistics', 500);
  }
};

/**
 * Generate testimonial certificate
 * @param {string} testimonialId
 * @param {string} template
 * @param {Object} customization
 * @returns {Promise<Object>}
 */
export const generateTestimonialCertificate = async (
  testimonialId,
  template = 'default',
  customization = {}
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const testimonial = await Testimonial.findById(testimonialId)
      .populate('seeker', 'firstName lastName')
      .session(session);

    if (!testimonial) {
      throw new AppError('Testimonial not found', 404);
    }

    // Generate certificate content
    const certificateData = {
      testimonialId,
      seekerName: `${testimonial.seeker.firstName} ${testimonial.seeker.lastName}`,
      givers: testimonial.givers.filter(g => g.isApproved).map(g => ({
        name: g.name,
        testimonial: g.testimonial,
        submittedAt: g.submittedAt
      })),
      projectDetails: testimonial.projectDetails,
      skills: testimonial.skills,
      generatedAt: new Date(),
      template,
      ...customization
    };

    // Generate certificate (implementation depends on your certificate generation service)
    const certificate = await generateCertificate(certificateData);

    // Update testimonial with certificate info
    testimonial.certificates = testimonial.certificates || [];
    testimonial.certificates.push({
      url: certificate.url,
      generatedAt: new Date(),
      template
    });

    await testimonial.save({ session });
    await session.commitTransaction();

    return certificate;

  } catch (error) {
    await session.abortTransaction();
    logger.error('Error generating certificate:', error);
    throw new AppError('Failed to generate certificate', 500);
  } finally {
    session.endSession();
  }
};

/**
 * Archive testimonial
 * @param {string} testimonialId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const archiveTestimonial = async (testimonialId, { userId, reason }) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const testimonial = await Testimonial.findById(testimonialId).session(session);
    if (!testimonial) {
      throw new AppError('Testimonial not found', 404);
    }

    testimonial.archived = true;
    testimonial.archivedAt = new Date();
    testimonial.archivedBy = userId;
    testimonial.archiveReason = reason;

    await testimonial.save({ session });

    // Log archive action
    await ActivityLog.create([{
      user: userId,
      action: 'TESTIMONIAL_ARCHIVED',
      details: {
        testimonialId,
        reason
      }
    }], { session });

    await session.commitTransaction();
    return testimonial;

  } catch (error) {
    await session.abortTransaction();
    logger.error('Error archiving testimonial:', error);
    throw new AppError('Failed to archive testimonial', 500);
  } finally {
    session.endSession();
  }
};

/**
 * Restore archived testimonial
 * @param {string} testimonialId
 * @param {string} userId
 * @returns {Promise<Object>}
 */
export const restoreTestimonial = async (testimonialId, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const testimonial = await Testimonial.findById(testimonialId).session(session);
    if (!testimonial) {
      throw new AppError('Testimonial not found', 404);
    }

    if (!testimonial.archived) {
      throw new AppError('Testimonial is not archived', 400);
    }

    testimonial.archived = false;
    testimonial.archivedAt = null;
    testimonial.archivedBy = null;
    testimonial.archiveReason = null;
    testimonial.restoredAt = new Date();
    testimonial.restoredBy = userId;

    await testimonial.save({ session });

    // Log restore action
    await ActivityLog.create([{
      user: userId,
      action: 'TESTIMONIAL_RESTORED',
      details: { testimonialId }
    }], { session });

    await session.commitTransaction();
    return testimonial;

  } catch (error) {
    await session.abortTransaction();
    logger.error('Error restoring testimonial:', error);
    throw new AppError('Failed to restore testimonial', 500);
  } finally {
    session.endSession();
  }
};

/**
 * Share testimonial with enhanced security and tracking
 * @param {string} testimonialId
 * @param {string} platform
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const shareTestimonial = async (testimonialId, platform, options = {}) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const testimonial = await Testimonial.findById(testimonialId)
      .populate('seeker', 'firstName lastName')
      .session(session);

    if (!testimonial) {
      throw new AppError('Testimonial not found', 404);
    }

    if (!testimonial.isPublic) {
      throw new AppError('Cannot share private testimonial', 403);
    }

    // Generate secure sharing token
    const shareToken = crypto.randomBytes(32).toString('hex');
    
    // Create share record
    const share = {
      token: shareToken,
      platform,
      sharedAt: new Date(),
      expiresAt: options.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days default
      options
    };

    testimonial.shares = testimonial.shares || [];
    testimonial.shares.push(share);

    await testimonial.save({ session });

    // Generate sharing URLs based on platform
    const shareUrl = generateShareUrl(testimonial, shareToken, platform);

    // Log share action
    await ActivityLog.create([{
      user: options.userId,
      action: 'TESTIMONIAL_SHARED',
      details: {
        testimonialId,
        platform,
        shareToken
      }
    }], { session });

    await session.commitTransaction();

    return {
      shareUrl,
      shareToken,
      expiresAt: share.expiresAt
    };

  } catch (error) {
    await session.abortTransaction();
    logger.error('Error sharing testimonial:', error);
    throw new AppError('Failed to share testimonial', 500);
  } finally {
    session.endSession();
  }
};

// Helper function to generate share URL
const generateShareUrl = (testimonial, token, platform) => {
  const baseUrl = process.env.CLIENT_URL;
  const shareUrl = `${baseUrl}/testimonials/share/${token}`;

  switch (platform) {
    case 'twitter':
      return `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
    case 'email':
      return shareUrl;
    default:
      return shareUrl;
  }
};

/**
 * Delete testimonial with enhanced validation and cleanup
 * @param {string} testimonialId - ID of testimonial to delete
 * @param {string} userId - ID of user requesting deletion
 * @returns {Promise<Object>}
 */
export const deleteTestimonial = async (testimonialId, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validate input
    if (!mongoose.Types.ObjectId.isValid(testimonialId)) {
      throw new AppError('Invalid testimonial ID', 400);
    }

    const testimonial = await Testimonial.findById(testimonialId)
      .populate('seeker', '_id')
      .session(session);

    if (!testimonial) {
      throw new AppError('Testimonial not found', 404);
    }

    // Check if user has permission to delete
    if (testimonial.seeker._id.toString() !== userId) {
      throw new AppError('Unauthorized to delete this testimonial', 403);
    }

    // Check if testimonial can be deleted
    if (testimonial.status === 'completed') {
      throw new AppError('Cannot delete completed testimonials', 400);
    }

    // Log deletion attempt
    logger.info({
      message: 'Attempting to delete testimonial',
      testimonialId,
      userId,
      status: testimonial.status
    });

    // Remove associated data (if any)
    if (testimonial.certificates && testimonial.certificates.length > 0) {
      // Clean up any stored certificates
      await Promise.all(testimonial.certificates.map(cert => 
        queues.cleanupQueue.add('deleteCertificate', { url: cert.url })
      ));
    }

    // Delete the testimonial
    await testimonial.remove({ session });

    // Create activity log
    await ActivityLog.create([{
      user: userId,
      action: 'TESTIMONIAL_DELETED',
      details: {
        testimonialId,
        status: testimonial.status,
        giverCount: testimonial.givers.length
      }
    }], { session });

    await session.commitTransaction();

    logger.info({
      message: 'Testimonial deleted successfully',
      testimonialId,
      userId
    });

    return { 
      message: 'Testimonial deleted successfully',
      deletedAt: new Date(),
      testimonialId
    };

  } catch (error) {
    await session.abortTransaction();
    
    logger.error({
      message: 'Error deleting testimonial',
      testimonialId,
      userId,
      error: error.message,
      stack: error.stack
    });

    throw error instanceof AppError 
      ? error 
      : new AppError('Failed to delete testimonial', 500);

  } finally {
    session.endSession();
  }
};

// Helper function to generate certificate (implement based on your needs)
const generateCertificate = async (data) => {
  // Implement certificate generation logic
  // This could involve using a PDF generation library, HTML to PDF conversion, etc.
  // Return the certificate URL or data
  return {
    url: 'https://example.com/certificates/123',
    generatedAt: new Date()
  };
};

/**
 * Process testimonial submission with enhanced validation and AI analysis
 * @param {Object} data - Testimonial submission data
 * @returns {Promise<Object>} Processed testimonial
 */
export const processTestimonialSubmission = async (data) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { testimonialId, giverToken, testimonialText, media = [], rating, relationship } = data;

    // Input validation
    if (!testimonialId || !giverToken || !testimonialText?.trim()) {
      throw new AppError('Missing required submission data', 400);
    }

    const testimonial = await Testimonial.findById(testimonialId).session(session);
    if (!testimonial) {
      throw new AppError('Testimonial not found', 404);
    }

    // Validate giver
    const giver = testimonial.givers.find(g => 
      g.verificationToken === giverToken && 
      g.verificationTokenExpiry > Date.now()
    );

    if (!giver) {
      throw new AppError('Invalid or expired submission token', 401);
    }

    // Perform parallel AI analysis with timeout protection
    const aiAnalysisPromises = [
      Promise.race([
        extractSkills(testimonialText),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Skills extraction timeout')), AI_TIMEOUT))
      ]),
      Promise.race([
        analyzeSentiment(testimonialText),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Sentiment analysis timeout')), AI_TIMEOUT))
      ]),
      Promise.race([
        analyzeEmotions(testimonialText),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Emotion analysis timeout')), AI_TIMEOUT))
      ])
    ];

    const [skills, sentiment, emotions] = await Promise.allSettled(aiAnalysisPromises)
      .then(results => results.map(r => r.status === 'fulfilled' ? r.value : null));

    // Update testimonial data
    Object.assign(giver, {
      testimonial: testimonialText.trim(),
      media,
      rating,
      relationship,
      submittedAt: new Date(),
      skills: skills || [],
      sentimentScore: sentiment?.score || 0,
      emotions: emotions || {},
      metadata: {
        wordCount: testimonialText.trim().split(/\s+/).length,
        submissionPlatform: 'web',
        hasMedia: media.length > 0
      }
    });

    // Update testimonial status
    testimonial.status = testimonial.givers.every(g => g.testimonial) 
      ? 'completed' 
      : 'in-progress';

    await testimonial.save({ session });
    await session.commitTransaction();

    // Queue analytics update
    await enqueueAnalyticsUpdate(testimonial.seeker);

    // Notify seeker
    await queues.notificationQueue.add(
      'testimonialSubmitted',
      {
        seekerId: testimonial.seeker,
        testimonialId,
        giverEmail: giver.email
      },
      { priority: 2 }
    );

    return testimonial;

  } catch (error) {
    await session.abortTransaction();
    logger.error('Testimonial submission processing failed:', error);
    throw error instanceof AppError ? error : new AppError('Submission processing failed', 500);
  } finally {
    session.endSession();
  }
};

/**
 * Report a testimonial with enhanced validation and evidence handling
 * @param {string} testimonialId
 * @param {Object} reportData
 * @returns {Promise<Object>}
 */
export const reportTestimonial = async (testimonialId, reportData) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      reason,
      description,
      evidence = [],
      reportedBy = 'anonymous',
      reportedAt = new Date(),
      ipAddress,
      userAgent
    } = reportData;

    // Validate input
    if (!reason?.trim()) {
      throw new AppError('Report reason is required', 400);
    }

    const testimonial = await Testimonial.findById(testimonialId).session(session);
    if (!testimonial) {
      throw new AppError('Testimonial not found', 404);
    }

    // Create report record
    const report = {
      reason: reason.trim(),
      description: description?.trim(),
      evidence,
      reportedBy,
      reportedAt,
      status: 'pending',
      metadata: {
        ipAddress,
        userAgent,
        platform: userAgent ? 'web' : 'api'
      }
    };

    testimonial.reports = testimonial.reports || [];
    testimonial.reports.push(report);

    // Update testimonial status if this is the first report
    if (!testimonial.status.includes('reported')) {
      testimonial.previousStatus = testimonial.status;
      testimonial.status = 'reported';
    }

    await testimonial.save({ session });

    // Notify administrators
    await queues.notificationQueue.add(
      'testimonialReported',
      {
        testimonialId,
        reportedBy,
        reason,
        evidence: evidence.length
      },
      { priority: 1 }
    );

    await session.commitTransaction();

    logger.info('Testimonial reported:', {
      testimonialId,
      reportedBy,
      reason
    });

    return testimonial;

  } catch (error) {
    await session.abortTransaction();
    logger.error('Error reporting testimonial:', error);
    throw error instanceof AppError ? error : new AppError('Failed to report testimonial', 500);
  } finally {
    session.endSession();
  }
};

/**
 * Get testimonials for seeker with advanced filtering and pagination
 * @param {string} seekerId
 * @param {Object} filters
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getTestimonialsForSeeker = async (seekerId, filters = {}, options = {}) => {
  try {
    const {
      status,
      search,
      startDate,
      endDate,
      category,
      rating,
      isPublic
    } = filters;

    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      order = 'desc'
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
        { 'givers.skills': { $in: [new RegExp(search, 'i')] } }
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
      Testimonial.countDocuments(query)
    ]);

    // Calculate statistics
    const stats = {
      total,
      approved: await Testimonial.countDocuments({ ...query, status: 'completed' }),
      pending: await Testimonial.countDocuments({ ...query, status: 'pending' }),
      averageRating: testimonials.reduce((acc, t) => {
        const ratings = t.givers.map(g => g.rating).filter(Boolean);
        return ratings.length ? acc + (ratings.reduce((a, b) => a + b, 0) / ratings.length) : acc;
      }, 0) / (testimonials.length || 1)
    };

    return {
      testimonials,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit
      },
      stats
    };

  } catch (error) {
    logger.error('Error fetching testimonials:', error);
    throw error instanceof AppError ? error : new AppError('Failed to fetch testimonials', 500);
  }
};

/**
 * Toggle testimonial visibility with enhanced validation and logging
 * @param {string} testimonialId - ID of the testimonial
 * @param {string} userId - ID of user making the change
 * @returns {Promise<Object>} Updated testimonial
 */
export const toggleTestimonialVisibility = async (testimonialId, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const testimonial = await Testimonial.findById(testimonialId).session(session);
    
    if (!testimonial) {
      throw new AppError('Testimonial not found', 404);
    }

    // Verify testimonial is in valid state for visibility toggle
    if (testimonial.status !== 'completed') {
      throw new AppError('Only completed testimonials can have visibility toggled', 400);
    }

    // Toggle visibility
    testimonial.isPublic = !testimonial.isPublic;
    testimonial.lastUpdated = new Date();
    testimonial.lastUpdatedBy = userId;

    // Add visibility change to history
    testimonial.visibilityHistory = testimonial.visibilityHistory || [];
    testimonial.visibilityHistory.push({
      status: testimonial.isPublic,
      changedBy: userId,
      changedAt: new Date(),
      reason: testimonial.isPublic ? 'Made public' : 'Made private'
    });

    await testimonial.save({ session });

    // Log visibility change
    await ActivityLog.create([{
      user: userId,
      action: 'TESTIMONIAL_VISIBILITY_CHANGED',
      details: {
        testimonialId,
        newStatus: testimonial.isPublic,
        timestamp: new Date()
      }
    }], { session });

    // Queue notification if making public
    if (testimonial.isPublic) {
      await queues.notificationQueue.add(
        'testimonialVisibilityChanged',
        {
          seekerId: testimonial.seeker,
          testimonialId,
          isPublic: true
        },
        { priority: 3 }
      );
    }

    await session.commitTransaction();

    logger.info({
      message: 'Testimonial visibility toggled',
      testimonialId,
      userId,
      isPublic: testimonial.isPublic
    });

    return testimonial;

  } catch (error) {
    await session.abortTransaction();
    logger.error({
      message: 'Error toggling testimonial visibility',
      testimonialId,
      userId,
      error: error.message,
      stack: error.stack
    });
    throw error instanceof AppError 
      ? error 
      : new AppError('Failed to toggle testimonial visibility', 500);
  } finally {
    session.endSession();
  }
};

export const getTestimonials = async (seekerId, { page = 1, limit = 10 }) => {
  const skip = (page - 1) * limit;

  const testimonials = await Testimonial.find({ seeker: seekerId })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Testimonial.countDocuments({ seeker: seekerId });

  return {
    testimonials,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      itemsPerPage: limit,
    },
  };
};

export const bulkApproveRejectTestimonials = async (testimonialIds, action, reason, adminId) => {
  try {
    const operations = testimonialIds.map(id => ({
      updateOne: {
        filter: { _id: id },
        update: {
          status: action === 'approve' ? 'approved' : 'rejected',
          adminId,
          reason,
        },
      },
    }));

    await Testimonial.bulkWrite(operations);
    // Log actions
  } catch (error) {
    logger.error('Bulk approve/reject failed:', error);
    throw new AppError('Bulk processing failed', 500);
  }
};

export default {
  createTestimonialRequest,
  submitTestimonial,
  processTestimonialSubmission,
  reportTestimonial,
  getTestimonialsForSeeker,
  approveTestimonial,
  rejectTestimonial,
  bulkProcessTestimonials,
  getTestimonialStats,
  approveTestimonial,
  generateTestimonialCertificate,
  archiveTestimonial,
  restoreTestimonial,
  shareTestimonial
};

