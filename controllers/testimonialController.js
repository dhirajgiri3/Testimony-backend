// src/controllers/testimonialController.js

import asyncHandler from 'express-async-handler';
import Testimonial from '../models/Testimonial.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
import {
  createTestimonialRequest,
  submitTestimonial,
  getTestimonialsForSeeker,
  reportTestimonial,
  approveTestimonial,
  rejectTestimonial,
  toggleTestimonialVisibility,
  shareTestimonial,
  bulkProcessTestimonials,
  getTestimonialStats,
  generateTestimonialCertificate,
  archiveTestimonial,
  restoreTestimonial,
  deleteTestimonial,
} from '../services/testimonialService.js';
import { enqueueAnalyticsUpdate } from '../services/analyticsService.js';
import { uploadToCloudinary } from '../config/cloudinary.js';
import aiService from '../services/aiService.js';
import { logUserActivity } from '../services/activityLogService.js';

/**
 * Create a new testimonial request with batch support
 * @route POST /api/v1/testimonials/create
 * @access Private (Seeker)
 */
export const createTestimonialRequestController = asyncHandler(
  async (req, res, next) => {
      req.body;

    const emails = Array.isArray(giverEmails) ? giverEmails : [giverEmails];

    if (!emails.length || !projectDetails) {
      throw new AppError('Giver emails and project details are required', 400);
    }

    try {
      const testimonial = await createTestimonialRequest(
        req.user.id,
        emails,
        projectDetails,
        {
          ...additionalData,
          templateId,
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip,
        }
      );

      // Log testimonial request creation activity
      await logUserActivity(req.user.id, 'CREATE_TESTIMONIAL_REQUEST', {
        testimonialId: testimonial.id,
      });

      res.status(201).json({
        success: true,
        message: `Testimonial request${
          emails.length > 1 ? 's' : ''
        } created successfully`,
        data: testimonial,
      });
    } catch (error) {
      logger.error('❌ Error creating testimonial request:', {
        error: error.message,
      });
      throw new AppError('Failed to create testimonial request', 500);
    }
  }
);

/**
 * Submit Testimonial with enhanced validation and media handling
 * @route POST /api/v1/testimonials/submit/:testimonialId/giver/:giverToken
 * @access Public (Giver via unique link)
 */
export const submitTestimonialController = asyncHandler(
  async (req, res, next) => {
    const { testimonialId, giverToken } = req.params;
    const { testimonialText, rating, relationship, skills, media } = req.body;

    // Enhanced validation
    if (
      !testimonialText ||
      typeof testimonialText !== 'string' ||
      !testimonialText.trim()
    ) {
      throw new AppError('Valid testimonial text is required', 400);
    }

    if (rating && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
      throw new AppError('Rating must be a number between 1 and 5', 400);
    }

    let mediaUrls = [];
    if (req.files?.length) {
      mediaUrls = await Promise.all(
        req.files.map((file) => uploadToCloudinary(file.buffer, file.mimetype))
      );
    }

    try {
      const testimonial = await submitTestimonial(testimonialId, giverToken, {
        testimonialText,
        rating,
        relationship,
        skills,
        media: [...mediaUrls, ...(media || [])],
      });

      // Process the testimonial text to extract insights using AI
      const analysis = await aiService.processTestimonialText(
        testimonial.testimonialText
      );

      // Save analysis results to the testimonial
      testimonial.analysis = analysis;
      await testimonial.save();

      // Enqueue analytics update
      await enqueueAnalyticsUpdate(testimonial.seeker);

      // Log testimonial submission activity
      await logUserActivity(testimonial.seeker, 'SUBMIT_TESTIMONIAL', {
        testimonialId: testimonial.id,
      });

      res.status(200).json({
        success: true,
        data: testimonial,
        message: 'Testimonial submitted successfully',
      });
    } catch (error) {
      logger.error('❌ Error submitting testimonial:', {
        error: error.message,
      });
      throw new AppError('Failed to submit testimonial', 500);
    }
  }
);

/**
 * Get testimonials with advanced filtering and sorting
 * @route GET /api/v1/testimonials
 * @access Private
 */
export const getTestimonialsController = asyncHandler(
  async (req, res, next) => {
    const {
      page = 1,
      limit = 10,
      status,
      sortBy = 'createdAt',
      order = 'desc',
      search,
      startDate,
      endDate,
      category,
      rating,
      isPublic,
    } = req.query;

    const filters = {
      status,
      search,
      startDate,
      endDate,
      category,
      rating,
      isPublic,
    };

    const options = {
      page,
      limit,
      sortBy,
      order,
    };

    try {
      const result = await getTestimonialsForSeeker(req.user.id, filters, options);

      res.status(200).json({
        success: true,
        data: result.testimonials,
        pagination: result.pagination,
        stats: result.stats,
      });
    } catch (error) {
      logger.error('❌ Error fetching testimonials:', { error: error.message });
      throw new AppError('Failed to fetch testimonials', 500);
    }
  }
);

/**
 * Get testimonial statistics and insights
 * @route GET /api/v1/testimonials/stats
 * @access Private
 */
export const getTestimonialStatsController = asyncHandler(
  async (req, res, next) => {
    try {
      const stats = await getTestimonialStats(req.user.id);

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('❌ Error fetching testimonial stats:', {
        error: error.message,
      });
      throw new AppError('Failed to fetch testimonial statistics', 500);
    }
  }
);

/**
 * Bulk process testimonials (Admin)
 * @route POST /api/v1/testimonials/bulk
 * @access Private (Admin)
 */
export const bulkProcessTestimonialsController = asyncHandler(
  async (req, res, next) => {
    const { testimonialIds, action, reason } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      throw new AppError('Invalid action for bulk processing', 400);
    }

    if (!Array.isArray(testimonialIds) || !testimonialIds.length) {
      throw new AppError(
        'Testimonial IDs are required for bulk processing',
        400
      );
    }

    try {
      const result = await bulkProcessTestimonials(testimonialIds, {
        action,
        reason,
        adminId: req.user.id,
      });

      // Log bulk processing activity
      await logUserActivity(req.user.id, 'BULK_PROCESS_TESTIMONIALS', {
        action,
        testimonialIds,
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: { processedTestimonialIds: testimonialIds },
      });
    } catch (error) {
      logger.error('❌ Error in bulk processing testimonials:', {
        error: error.message,
      });
      throw new AppError('Failed to bulk process testimonials', 500);
    }
  }
);

/**
 * Archive testimonial
 * @route PUT /api/v1/testimonials/:testimonialId/archive
 * @access Private
 */
export const archiveTestimonialController = asyncHandler(
  async (req, res, next) => {
    const { testimonialId } = req.params;
    const { reason } = req.body;

    if (!testimonialId) {
      throw new AppError('Testimonial ID is required', 400);
    }

    try {
      await archiveTestimonial(testimonialId, {
        userId: req.user.id,
        reason,
      });

      // Log testimonial archival activity
      await logUserActivity(req.user.id, 'ARCHIVE_TESTIMONIAL', {
        testimonialId,
        reason,
      });

      res.status(200).json({
        success: true,
        message: 'Testimonial archived successfully',
      });
    } catch (error) {
      logger.error('❌ Error archiving testimonial:', { error: error.message });
      throw new AppError('Failed to archive testimonial', 500);
    }
  }
);

/**
 * Restore archived testimonial
 * @route PUT /api/v1/testimonials/:testimonialId/restore
 * @access Private
 */
export const restoreTestimonialController = asyncHandler(
  async (req, res, next) => {
    const { testimonialId } = req.params;

    if (!testimonialId) {
      throw new AppError('Testimonial ID is required', 400);
    }

    try {
      await restoreTestimonial(testimonialId, req.user.id);

      // Log testimonial restoration activity
      await logUserActivity(req.user.id, 'RESTORE_TESTIMONIAL', {
        testimonialId,
      });

      res.status(200).json({
        success: true,
        message: 'Testimonial restored successfully',
      });
    } catch (error) {
      logger.error('❌ Error restoring testimonial:', { error: error.message });
      throw new AppError('Failed to restore testimonial', 500);
    }
  }
);

/**
 * Report inappropriate testimonial
 * @route POST /api/v1/testimonials/:testimonialId/report
 * @access Public
 */
export const reportTestimonialController = asyncHandler(
  async (req, res, next) => {
    const { testimonialId } = req.params;
    const { reason, description, evidence } = req.body;

    // Enhanced validation
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      throw new AppError('Report reason is required and must be a string', 400);
    }

    let evidenceUrls = [];
    if (req.files?.length) {
      evidenceUrls = await Promise.all(
        req.files.map((file) => uploadToCloudinary(file.buffer, file.mimetype))
      );
    }

    try {
      await reportTestimonial(testimonialId, {
        reason,
        description,
        evidence: [...evidenceUrls, ...(evidence || [])],
        reportedBy: req.user?.id || 'anonymous',
        reportedAt: new Date(),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      // Log testimonial report activity
      await logUserActivity(req.user.id || 'anonymous', 'REPORT_TESTIMONIAL', {
        testimonialId,
      });

      res.status(200).json({
        success: true,
        message: 'Testimonial reported successfully',
      });
    } catch (error) {
      logger.error('❌ Error reporting testimonial:', { error: error.message });
      throw new AppError('Failed to report testimonial', 500);
    }
  }
);

/**
 * Approve testimonial (Admin)
 * @route PUT /api/v1/testimonials/approve/:testimonialId
 * @access Private (Admin)
 */
export const approveTestimonialController = asyncHandler(
  async (req, res, next) => {
    const { testimonialId } = req.params;
    const { giverId, comments } = req.body;

    if (!testimonialId) {
      throw new AppError('Testimonial ID is required', 400);
    }

    if (!giverId) {
      throw new AppError('Giver ID is required for approval', 400);
    }

    try {
      const testimonial = await approveTestimonial(
        testimonialId,
        giverId,
        req.user.id,
        comments
      );

      // Log testimonial approval activity
      await logUserActivity(req.user.id, 'APPROVE_TESTIMONIAL', {
        testimonialId,
        giverId,
      });

      res.status(200).json({
        success: true,
        data: testimonial,
        message: 'Testimonial approved successfully',
      });
    } catch (error) {
      logger.error('❌ Error approving testimonial:', { error: error.message });
      throw new AppError('Failed to approve testimonial', 500);
    }
  }
);

/**
 * Reject testimonial (Admin)
 * @route PUT /api/v1/testimonials/reject/:testimonialId
 * @access Private (Admin)
 */
export const rejectTestimonialController = asyncHandler(
  async (req, res, next) => {
    const { testimonialId } = req.params;
    const { giverId, comments } = req.body;

    if (!testimonialId) {
      throw new AppError('Testimonial ID is required', 400);
    }

    if (!giverId) {
      throw new AppError('Giver ID is required for rejection', 400);
    }

    try {
      const testimonial = await rejectTestimonial(
        testimonialId,
        giverId,
        req.user.id,
        comments
      );

      // Log testimonial rejection activity
      await logUserActivity(req.user.id, 'REJECT_TESTIMONIAL', {
        testimonialId,
        giverId,
      });

      res.status(200).json({
        success: true,
        data: testimonial,
        message: 'Testimonial rejected successfully',
      });
    } catch (error) {
      logger.error('❌ Error rejecting testimonial:', { error: error.message });
      throw new AppError('Failed to reject testimonial', 500);
    }
  }
);

/**
 * Toggle testimonial visibility (Admin)
 * @route PUT /api/v1/testimonials/:testimonialId/toggle-visibility
 * @access Private (Admin)
 */
export const toggleVisibilityController = asyncHandler(
  async (req, res, next) => {
    const { testimonialId } = req.params;

    if (!testimonialId) {
      throw new AppError('Testimonial ID is required', 400);
    }

    try {
      const testimonial = await toggleTestimonialVisibility(
        testimonialId,
        req.user.id
      );

      // Log visibility toggle activity
      await logUserActivity(req.user.id, 'TOGGLE_TESTIMONIAL_VISIBILITY', {
        testimonialId,
      });

      res.status(200).json({
        success: true,
        data: testimonial,
        message: 'Testimonial visibility updated successfully',
      });
    } catch (error) {
      logger.error('❌ Error toggling testimonial visibility:', {
        error: error.message,
      });
      throw new AppError('Failed to toggle testimonial visibility', 500);
    }
  }
);

/**
 * Share testimonial
 * @route POST /api/v1/testimonials/:testimonialId/share
 * @access Private
 */
export const shareTestimonialController = asyncHandler(
  async (req, res, next) => {
    const { testimonialId } = req.params;
    const { platform } = req.body;

    if (!testimonialId) {
      throw new AppError('Testimonial ID is required', 400);
    }

    if (!platform || typeof platform !== 'string') {
      throw new AppError('Platform is required and must be a string', 400);
    }

    try {
      const testimonial = await shareTestimonial(testimonialId, platform);

      // Log testimonial sharing activity
      await logUserActivity(req.user.id, 'SHARE_TESTIMONIAL', {
        testimonialId,
        platform,
      });

      res.status(200).json({
        success: true,
        data: testimonial,
        message: 'Testimonial shared successfully',
      });
    } catch (error) {
      logger.error('❌ Error sharing testimonial:', { error: error.message });
      throw new AppError('Failed to share testimonial', 500);
    }
  }
);

/**
 * Generate a comprehensive AI testimonial certificate
 * @route POST /api/v1/testimonials/:testimonialId/certificate
 * @access Private
 */
export const generateCertificateController = asyncHandler(
  async (req, res, next) => {
    const { testimonialId } = req.params;
    const { template, customization } = req.body;

    if (!testimonialId) {
      throw new AppError('Testimonial ID is required', 400);
    }

    try {
      const certificate = await generateTestimonialCertificate(
        testimonialId,
        template,
        customization
      );

      // Log certificate generation activity
      await logUserActivity(req.user.id, 'GENERATE_TESTIMONIAL_CERTIFICATE', {
        testimonialId,
      });

      res.status(200).json({
        success: true,
        data: certificate,
        message: 'Testimonial certificate generated successfully',
      });
    } catch (error) {
      logger.error('❌ Error generating testimonial certificate:', {
        error: error.message,
      });
      throw new AppError('Failed to generate testimonial certificate', 500);
    }
  }
);

/**
 * Delete testimonial
 * @route DELETE /api/v1/testimonials/:testimonialId
 * @access Private
 */
export const deleteTestimonialController = asyncHandler(
  async (req, res, next) => {
    const { testimonialId } = req.params;

    if (!testimonialId) {
      throw new AppError('Testimonial ID is required', 400);
    }

    try {
      await deleteTestimonial(testimonialId, req.user.id);

      // Log testimonial deletion activity
      await logUserActivity(req.user.id, 'DELETE_TESTIMONIAL', {
        testimonialId,
      });

      res.status(200).json({
        success: true,
        message: 'Testimonial deleted successfully',
      });
    } catch (error) {
      logger.error('❌ Error deleting testimonial:', { error: error.message });
      throw new AppError('Failed to delete testimonial', 500);
    }
  }
);

/**
 * Get public testimonials with advanced filtering and sorting
 * @route GET /api/v1/testimonials/public
 * @access Public
 */
export const getPublicTestimonialsController = asyncHandler(
  async (req, res, next) => {
    const {
      page = 1,
      limit = 10,
      search,
      category,
      rating,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query;

    const filters = {
      isPublic: true,
    };

    if (category) filters.category = category;
    if (rating) filters.rating = parseInt(rating, 10);
    if (search) {
      filters.$or = [
        { testimonialText: { $regex: search, $options: 'i' } },
        { relationship: { $regex: search, $options: 'i' } },
      ];
    }

    const sortOrder = order === 'asc' ? 1 : -1;

    try {
      const testimonials = await Testimonial.find(filters)
        .sort({ [sortBy]: sortOrder })
        .skip((page - 1) * limit)
        .limit(parseInt(limit, 10))
        .lean();

      const total = await Testimonial.countDocuments(filters);

      res.status(200).json({
        success: true,
        data: testimonials,
        pagination: {
          total,
          page: parseInt(page, 10),
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('❌ Error fetching public testimonials:', {
        error: error.message,
      });
      throw new AppError('Failed to fetch public testimonials', 500);
    }
  }
);

/**
 * Get testimonial by ID
 * @route GET /api/v1/testimonials/:testimonialId
 * @access Private
 */
export const getTestimonialByIdController = asyncHandler(
  async (req, res, next) => {
    const { testimonialId } = req.params;

    if (!testimonialId) {
      throw new AppError('Testimonial ID is required', 400);
    }

    try {
      const testimonial = await Testimonial.findById(testimonialId).lean();

      if (!testimonial) {
        throw new AppError('Testimonial not found', 404);
      }

      res.status(200).json({
        success: true,
        data: testimonial,
      });
    } catch (error) {
      logger.error('❌ Error fetching testimonial by ID:', {
        error: error.message,
      });
      throw new AppError('Failed to fetch testimonial by ID', 500);
    }
  }
);

/**
 * Search testimonials
 * @route GET /api/v1/testimonials/search
 * @access Private
 */
export const searchTestimonialsController = asyncHandler(
  async (req, res, next) => {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || !q.trim()) {
      throw new AppError('Search query is required and must be a string', 400);
    }

    try {
      const results = await Testimonial.find({
        seeker: req.user.id,
        $or: [
          { testimonialText: { $regex: q, $options: 'i' } },
          { relationship: { $regex: q, $options: 'i' } },
        ],
      }).lean();

      res.status(200).json({
        success: true,
        data: results,
      });
    } catch (error) {
      logger.error('❌ Error searching testimonials:', {
        error: error.message,
      });
      throw new AppError('Failed to search testimonials', 500);
    }
  }
);

export {
  createTestimonialRequestController,
  submitTestimonialController,
  getTestimonialsController,
  getTestimonialStatsController,
  bulkProcessTestimonialsController,
  archiveTestimonialController,
  restoreTestimonialController,
  reportTestimonialController,
  approveTestimonialController,
  rejectTestimonialController,
  toggleVisibilityController,
  shareTestimonialController,
  getPublicTestimonialsController,
  getTestimonialByIdController,
  searchTestimonialsController,
  deleteTestimonialController,
};
