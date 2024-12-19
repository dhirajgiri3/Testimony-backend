// src/routes/api/v1/users.js

import express from 'express';
import {
  getUserProfile,
  updateProfile,
  updatePreferences,
  updateSettings,
  deleteAccount,
  getMe,
  exportData,
  forgotPassword,
  performPasswordReset,
  enable2FA,
  disable2FA,
  uploadProfilePic
} from '../../../controllers/userController.js';
import { protect } from '../../../middlewares/auth.js';
import { validateRequest } from '../../../middlewares/validate.js';
import { sanitizeBody } from '../../../middlewares/sanitize.js';
import {
  profileUpdateRateLimiter,
  emailVerificationRateLimiter,
} from '../../../middlewares/rateLimiter.js';
import { cache } from '../../../middlewares/cache.js';
import { upload } from '../../../middlewares/upload.js'; // Middleware for file uploads
import {
  passwordResetValidation,
  twoFactorValidation,
  updateProfileValidation,
  updatePreferencesValidation, // Ensure this is a middleware function
  updateSettingsValidation, // Ensure this is a middleware function
  createValidator
} from '../../../utils/validators.js';

const router = express.Router();

// Profile routes
router.get('/profile', protect, cache(300), getUserProfile);
router.put(
  '/profile',
  protect,
  profileUpdateRateLimiter,
  sanitizeBody,
  createValidator(updateProfileValidation.basicInfo),
  validateRequest,
  updateProfile
);

// Preferences routes
router.put(
  '/preferences',
  protect,
  profileUpdateRateLimiter,
  sanitizeBody,
  createValidator(updatePreferencesValidation), // Ensure this is a middleware function
  validateRequest,
  updatePreferences // Ensure this is a controller function
);

// Settings routes
router.put(
  '/settings',
  protect,
  profileUpdateRateLimiter,
  sanitizeBody,
  createValidator(updateSettingsValidation), // Ensure this is a middleware function
  validateRequest,
  updateSettings // Ensure this is a controller function
);

// Account management routes
router.delete(
  '/account',
  protect,
  emailVerificationRateLimiter,
  deleteAccount
);

// Get current user with caching
router.get('/me', protect, cache(300), getMe); // Cache for 5 minutes

// Export user data
router.get('/export-data', protect, exportData);

// Password reset routes
router.post(
  '/forgot-password',
  sanitizeBody,
  createValidator(passwordResetValidation.requestReset),
  validateRequest,
  forgotPassword
);
router.post(
  '/reset-password',
  sanitizeBody,
  createValidator(passwordResetValidation.resetPassword),
  validateRequest,
  performPasswordReset
);

// Two-Factor Authentication routes
router.post(
  '/enable-2fa',
  protect,
  sanitizeBody,
  createValidator(twoFactorValidation.setup),
  validateRequest,
  enable2FA
);
router.post(
  '/disable-2fa',
  protect,
  sanitizeBody,
  createValidator(twoFactorValidation.disable),
  validateRequest,
  disable2FA
);

// Profile picture upload route
router.post(
  '/upload-profile-picture',
  protect,
  upload.single('profilePicture'),
  uploadProfilePic
);

export default router;