// src/routes/api/v1/testimonials.js

import express from "express";
import {
  createTestimonialRequestController,
  submitTestimonialController,
  getTestimonialsController,
  reportTestimonialController,
  approveTestimonialController,
  rejectTestimonialController,
  toggleVisibilityController,
  shareTestimonialController,
  bulkProcessTestimonialsController,
  getPublicTestimonialsController,
  getTestimonialByIdController,
  searchTestimonialsController,
  getTestimonialStatsController,
  generateCertificateController,
  archiveTestimonialController,
  restoreTestimonialController,
  deleteTestimonialController,
  getTestimonials,
  bulkApproveRejectTestimonials,
} from "../../../controllers/testimonialController.js";
import { protect } from "../../../middlewares/auth.js";
import { authorize } from "../../../middlewares/role.js";
import {
  testimonialRequestValidation,
  testimonialApprovalValidation,
  testimonialVisibilityValidation,
  testimonialShareValidation,
  bulkProcessValidation,
  testimonialReportValidation,
  certificateGenerationValidation,
  archiveRestoreValidation,
  createValidator,
} from "../../../utils/validators.js";
import { validateRequest } from "../../../middlewares/validate.js";
import {
  validateGetTestimonials,
  validateBulkAction,
} from "../../../middlewares/validators/testimonialValidator.js";
import { rateLimitTestimonials } from "../../../middlewares/rateLimiter.js";

const router = express.Router();

// Create testimonial request (Seeker)
router.post(
  "/create",
  protect,
  authorize("seeker"),
  rateLimitTestimonials,
  createValidator(testimonialRequestValidation),
  validateRequest,
  createTestimonialRequestController
);

// Submit testimonial (Giver via unique link)
router.post(
  "/submit/:testimonialId/giver/:giverToken",
  submitTestimonialController
);

// Report a testimonial (Viewer)
router.post(
  "/report/:testimonialId",
  createValidator(testimonialReportValidation),
  validateRequest,
  reportTestimonialController
);

// Approve a testimonial (Admin)
router.put(
  "/approve/:testimonialId",
  protect,
  authorize("admin"),
  createValidator(testimonialApprovalValidation),
  validateRequest,
  approveTestimonialController
);

// Reject a testimonial (Admin)
router.put(
  "/reject/:testimonialId",
  protect,
  authorize("admin"),
  createValidator(testimonialApprovalValidation),
  validateRequest,
  rejectTestimonialController
);

// Toggle testimonial visibility (Admin)
router.put(
  "/:testimonialId/toggle-visibility",
  protect,
  authorize("admin"),
  createValidator(testimonialVisibilityValidation),
  validateRequest,
  toggleVisibilityController
);

// Share a testimonial
router.post(
  "/:testimonialId/share",
  protect,
  authorize("seeker", "admin"),
  createValidator(testimonialShareValidation),
  validateRequest,
  shareTestimonialController
);

// Bulk process testimonials (Admin)
router.post(
  "/bulk-process",
  protect,
  authorize("admin"),
  createValidator(bulkProcessValidation),
  validateRequest,
  bulkProcessTestimonialsController
);

// Generate testimonial certificate (Admin/Seeker)
router.post(
  "/:testimonialId/certificate",
  protect,
  authorize("admin", "seeker"),
  createValidator(certificateGenerationValidation),
  validateRequest,
  generateCertificateController
);

// Archive testimonial (Admin)
router.put(
  "/:testimonialId/archive",
  protect,
  authorize("admin"),
  createValidator(archiveRestoreValidation),
  validateRequest,
  archiveTestimonialController
);

// Restore testimonial (Admin)
router.put(
  "/:testimonialId/restore",
  protect,
  authorize("admin"),
  createValidator(archiveRestoreValidation),
  validateRequest,
  restoreTestimonialController
);

// CRUD operations for testimonials

// Create a new testimonial
router.post("/", protect, createTestimonialRequestController);

// Get all testimonials for a seeker
router.get("/:seekerId", protect, getTestimonialsController);

// Get public testimonials
router.get("/public", getPublicTestimonialsController);

// Get testimonial by ID
router.get("/:testimonialId", getTestimonialByIdController);

// Search testimonials
router.get("/search", protect, searchTestimonialsController);

// Get testimonial statistics
router.get("/stats", protect, getTestimonialStatsController);
// Get testimonials with pagination

// Delete a testimonial
router.delete(
  "/:testimonialId",
  protect,
  authorize("admin"),
  deleteTestimonialController
);

// Get testimonials with pagination
router.get("/", protect, validateGetTestimonials, getTestimonials);

// Bulk approve or reject testimonials
router.post(
  "/bulk-action",
  protect,
  authorize("admin"),
  validateBulkAction,
  bulkApproveRejectTestimonials
);

export default router;
