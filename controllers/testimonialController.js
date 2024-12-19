import asyncHandler from "express-async-handler";
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
  getTestimonials as getTestimonialsService,
  bulkApproveRejectTestimonials as bulkApproveRejectService
} from "../services/testimonialService.js";
import { enqueueAnalyticsUpdate } from "../services/analyticsService.js";
import AppError from "../utils/appError.js";
import { logger } from "../utils/logger.js";
import Testimonial from "../models/Testimonial.js";
import { uploadToCloudinary } from "../config/cloudinary.js";
import { processTestimonialText } from '../services/aiService.js';

/**
 * @desc    Create a new testimonial request with batch support
 * @route   POST /api/v1/testimonials/create
 * @access  Private (Seeker)
 */
export const createTestimonialRequestController = asyncHandler(async (req, res) => {
  const { giverEmails, projectDetails, additionalData, templateId } = req.body;

  const emails = Array.isArray(giverEmails) ? giverEmails : [giverEmails];

  if (!emails.length || !projectDetails) {
    throw new AppError("Giver emails and project details are required", 400);
  }

  const testimonial = await createTestimonialRequest(
    req.user.id,
    emails,
    projectDetails,
    {
      ...additionalData,
      templateId,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip
    }
  );

  res.status(201).json({
    success: true,
    message: `Testimonial request${emails.length > 1 ? 's' : ''} created successfully`,
    data: testimonial,
  });
});

/**
 * @desc    Submit Testimonial with enhanced validation and media handling
 * @route   POST /api/v1/testimonials/submit/:testimonialId/giver/:giverToken
 * @access  Public (Giver via unique link)
 */
export const submitTestimonialController = asyncHandler(async (req, res) => {
  const { testimonialId, giverToken } = req.params;
  const { testimonialText, rating, relationship, skills, media } = req.body;

  // Enhanced validation
  if (!testimonialText || typeof testimonialText !== 'string' || !testimonialText.trim()) {
    throw new AppError("Valid testimonial text is required", 400);
  }

  if (rating && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
    throw new AppError("Rating must be a number between 1 and 5", 400);
  }

  let mediaUrls = [];
  if (req.files?.length) {
    mediaUrls = await Promise.all(
      req.files.map(file => uploadToCloudinary(file.buffer, file.mimetype))
    );
  }

  const testimonial = await submitTestimonial(
    testimonialId,
    giverToken,
    {
      testimonialText,
      rating,
      relationship,
      skills,
      media: [...mediaUrls, ...(media || [])]
    }
  );

  // Process the testimonial text to extract insights
  const analysis = await processTestimonialText(testimonial.testimonialText);
  // Save analysis results to the testimonial
  // ...existing code...

  await enqueueAnalyticsUpdate(testimonial.seeker);

  res.status(200).json({
    success: true,
    data: testimonial,
    message: "Testimonial submitted successfully"
  });
});

/**
 * @desc    Get testimonials with advanced filtering and sorting
 * @route   GET /api/v1/testimonials
 * @access  Private
 */
export const getTestimonialsController = asyncHandler(async (req, res) => {
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
    isPublic
  } = req.query;

  const filters = {
    status,
    search,
    startDate,
    endDate,
    category,
    rating,
    isPublic: isPublic === 'true'
  };

  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    sortBy,
    order
  };

  const result = await getTestimonialsForSeeker(req.user.id, filters, options);

  res.status(200).json({
    success: true,
    data: result.testimonials,
    pagination: result.pagination,
    stats: result.stats
  });
});

/**
 * @desc    Get testimonial statistics and insights
 * @route   GET /api/v1/testimonials/stats
 * @access  Private
 */
export const getTestimonialStatsController = asyncHandler(async (req, res) => {
  const stats = await getTestimonialStats(req.user.id);

  res.status(200).json({
    success: true,
    data: stats
  });
});

/**
 * @desc    Bulk process testimonials (Admin)
 * @route   POST /api/v1/testimonials/bulk
 * @access  Private (Admin)
 */
export const bulkProcessTestimonialsController = asyncHandler(async (req, res) => {
  const { testimonialIds, action, reason } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    throw new AppError("Invalid action for bulk processing", 400);
  }

  if (!Array.isArray(testimonialIds) || !testimonialIds.length) {
    throw new AppError("Testimonial IDs are required for bulk processing", 400);
  }

  const result = await bulkProcessTestimonials(testimonialIds, {
    action,
    reason,
    adminId: req.user.id
  });

  res.status(200).json({
    success: true,
    message: result.message,
    data: { processedTestimonialIds: testimonialIds }
  });
});

/**
 * @desc    Generate testimonial certificate
 * @route   POST /api/v1/testimonials/:testimonialId/certificate
 * @access  Private
 */
export const generateCertificateController = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;
  const { template, customization } = req.body;

  const certificate = await generateTestimonialCertificate(
    testimonialId,
    template,
    customization
  );

  res.status(200).json({
    success: true,
    data: certificate
  });
});

/**
 * @desc    Archive testimonial
 * @route   PUT /api/v1/testimonials/:testimonialId/archive
 * @access  Private
 */
export const archiveTestimonialController = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;
  const { reason } = req.body;

  await archiveTestimonial(testimonialId, {
    userId: req.user.id,
    reason
  });

  res.status(200).json({
    success: true,
    message: "Testimonial archived successfully"
  });
});

/**
 * @desc    Restore archived testimonial
 * @route   PUT /api/v1/testimonials/:testimonialId/restore
 * @access  Private
 */
export const restoreTestimonialController = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;

  await restoreTestimonial(testimonialId, req.user.id);

  res.status(200).json({
    success: true,
    message: "Testimonial restored successfully"
  });
});

/**
 * @desc    Report inappropriate testimonial
 * @route   POST /api/v1/testimonials/:testimonialId/report
 * @access  Public
 */
export const reportTestimonialController = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;
  const { reason, description, evidence } = req.body;

  // Enhanced validation
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    throw new AppError("Report reason is required and must be a string", 400);
  }

  let evidenceUrls = [];
  if (req.files?.length) {
    evidenceUrls = await Promise.all(
      req.files.map(file => uploadToCloudinary(file.buffer, file.mimetype))
    );
  }

  await reportTestimonial(testimonialId, {
    reason,
    description,
    evidence: [...evidenceUrls, ...(evidence || [])],
    reportedBy: req.user?.id || 'anonymous',
    reportedAt: new Date(),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent']
  });

  res.status(200).json({
    success: true,
    message: "Testimonial reported successfully"
  });
});

/**
 * @desc    Approve testimonial (Admin)
 * @route   PUT /api/v1/testimonials/approve/:testimonialId
 * @access  Private (Admin)
 */
export const approveTestimonialController = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;
  const { giverId, comments } = req.body;

  // Enhanced validation
  if (!giverId) {
    throw new AppError("Giver ID is required for approval", 400);
  }

  const testimonial = await approveTestimonial(testimonialId, giverId, req.user.id, comments);

  logger.info({
    message: "Testimonial approved",
    testimonialId,
    giverId,
    adminId: req.user.id
  });

  res.status(200).json({
    success: true,
    data: testimonial,
    message: "Testimonial approved successfully"
  });
});

/**
 * @desc    Reject testimonial (Admin)
 * @route   PUT /api/v1/testimonials/reject/:testimonialId
 * @access  Private (Admin)
 */
export const rejectTestimonialController = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;
  const { giverId, comments } = req.body;

  // Enhanced validation
  if (!giverId) {
    throw new AppError("Giver ID is required for rejection", 400);
  }

  const testimonial = await rejectTestimonial(testimonialId, giverId, req.user.id, comments);

  logger.info({
    message: "Testimonial rejected",
    testimonialId,
    giverId,
    adminId: req.user.id
  });

  res.status(200).json({
    success: true,
    data: testimonial,
    message: "Testimonial rejected successfully"
  });
});

/**
 * @desc    Toggle testimonial visibility (Admin)
 * @route   PUT /api/v1/testimonials/:testimonialId/toggle-visibility
 * @access  Private (Admin)
 */
export const toggleVisibilityController = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;

  const testimonial = await toggleTestimonialVisibility(testimonialId, req.user.id);

  res.status(200).json({
    success: true,
    data: testimonial,
    message: "Testimonial visibility updated successfully"
  });
});

/**
 * @desc    Share testimonial
 * @route   POST /api/v1/testimonials/:testimonialId/share
 * @access  Private
 */
export const shareTestimonialController = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;
  const { platform } = req.body;

  const sharedLink = await shareTestimonial(testimonialId, platform);

  res.status(200).json({
    success: true,
    data: sharedLink,
    message: "Testimonial shared successfully"
  });
});

/**
 * @desc    Get public testimonials
 * @route   GET /api/v1/testimonials/public
 * @access  Public
 */
export const getPublicTestimonialsController = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, category, rating, sortBy = 'createdAt', order = 'desc' } = req.query;

  const filters = {
    search,
    category,
    rating,
    isPublic: true
  };

  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    sortBy,
    order
  };

  const result = await getTestimonialsForSeeker(null, filters, options);

  res.status(200).json({
    success: true,
    data: result.testimonials,
    pagination: result.pagination
  });
});

/**
 * @desc    Get testimonial by ID
 * @route   GET /api/v1/testimonials/:testimonialId
 * @access  Private/Public based on visibility
 */
export const getTestimonialByIdController = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;

  const testimonial = await Testimonial.findById(testimonialId);

  if (!testimonial) {
    throw new AppError("Testimonial not found", 404);
  }

  if (!testimonial.isPublic && (!req.user || req.user.id !== testimonial.seeker.toString())) {
    throw new AppError("Unauthorized access to this testimonial", 403);
  }

  res.status(200).json({
    success: true,
    data: testimonial
  });
});

/**
 * @desc    Search testimonials
 * @route   GET /api/v1/testimonials/search
 * @access  Private
 */
export const searchTestimonialsController = asyncHandler(async (req, res) => {
  const { query } = req;

  const results = await Testimonial.find({
    $or: [
      { testimonialText: { $regex: query.q, $options: 'i' } },
      { relationship: { $regex: query.q, $options: 'i' } }
    ]
  });

  res.status(200).json({
    success: true,
    data: results
  });
});

/**
 * @desc    Delete a testimonial
 * @route   DELETE /api/v1/testimonials/:testimonialId
 * @access  Private (Admin)
 */
export const deleteTestimonialController = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;

  await deleteTestimonial(testimonialId);

  res.status(200).json({
    success: true,
    message: "Testimonial deleted successfully"
  });
});

// Error handler for uncaught testimonial errors
export const handleTestimonialError = (err, req, res, next) => {
  logger.error('Testimonial Error:', {
    error: err.message,
    stack: err.stack,
    user: req.user?.id,
    path: req.path,
    method: req.method
  });

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message
    });
  }

  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred while processing the testimonial'
  });
};

/**
 * @desc    Get testimonials with pagination
 * @route   GET /api/v1/testimonials
 * @access  Private
 */
export const getTestimonials = asyncHandler(async (req, res, next) => {
  const { page, limit } = req.query;
  const seekerId = req.user.id; // Assuming the user ID is the seeker ID

  const testimonialsData = await getTestimonialsService(seekerId, {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 10,
  });

  res.status(200).json({
    success: true,
    data: testimonialsData,
  });
});

/**
 * @desc    Bulk approve or reject testimonials
 * @route   POST /api/v1/testimonials/bulk-action
 * @access  Private/Admin
 */
export const bulkApproveRejectTestimonials = asyncHandler(async (req, res, next) => {
  const { testimonialIds, action, reason } = req.body;
  const adminId = req.user.id; // Admin performing the action

  if (!testimonialIds || !Array.isArray(testimonialIds) || testimonialIds.length === 0) {
    return next(new AppError('Please provide an array of testimonial IDs', 400));
  }

  if (!['approve', 'reject'].includes(action)) {
    return next(new AppError('Action must be either "approve" or "reject"', 400));
  }

  await bulkApproveRejectService(testimonialIds, action, reason, adminId);

  res.status(200).json({
    success: true,
    message: `Testimonials ${action}d successfully`,
  });
});
