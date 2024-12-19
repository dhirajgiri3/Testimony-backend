import express from "express";
import {
  getUserProfile,
  updatePreferences,
  updateSettings,
  deleteAccount,
  getMe,
  exportData,
  forgotPassword,
  enable2FA,
  disable2FA,
  uploadProfilePic,
} from "../../../controllers/userController.js";
import { protect } from "../../../middlewares/auth.js";
import { validateRequest } from "../../../middlewares/validate.js";
import { sanitizeBody } from "../../../middlewares/sanitize.js";
import {
  profileUpdateRateLimiter,
  emailVerificationRateLimiter,
  loginRateLimiter,
} from "../../../middlewares/rateLimiter.js";
import { cache } from "../../../middlewares/cache.js";
import { upload } from "../../../middlewares/upload.js"; // Middleware for file uploads
import {
  passwordResetValidation,
  twoFactorValidation,
  updateProfileValidation,
  updatePreferencesValidation,
  updateSettingsValidation,
  createValidator,
} from "../../../utils/validators.js";
import {
  getNotifications,
  markAsRead,
  deleteNotificationHandler,
} from "../../../controllers/notificationController.js";
import {
  disableTwoFactorAuth,
  enableTwoFactorAuth,
  setupTwoFactorAuth,
} from "../../../services/twoFactorService.js";
import { performPasswordReset, updateUserProfile } from "../../../services/userService.js";

const router = express.Router();

// Get current user
router.get("/me", protect, cache("user_me", 300), getMe);

// Profile routes
router.get("/profile", protect, cache("user_profile", 300), getUserProfile);
router.put(
  "/profile",
  protect,
  profileUpdateRateLimiter,
  sanitizeBody,
  createValidator(updateProfileValidation.basicInfo),
  validateRequest,
  updateUserProfile
);

// Preferences routes
router.put(
  "/preferences",
  protect,
  profileUpdateRateLimiter,
  sanitizeBody,
  createValidator(updatePreferencesValidation),
  validateRequest,
  updatePreferences
);

// Settings routes
router.put(
  "/settings",
  protect,
  profileUpdateRateLimiter,
  sanitizeBody,
  createValidator(updateSettingsValidation),
  validateRequest,
  updateSettings
);

// Account management routes
router.delete("/account", protect, emailVerificationRateLimiter, deleteAccount);

// Export user data
router.get("/export-data", protect, exportData);

// Password reset routes
router.post(
  "/forgot-password",
  sanitizeBody,
  createValidator(passwordResetValidation.requestReset),
  validateRequest,
  forgotPassword
);
router.post(
  "/reset-password",
  sanitizeBody,
  createValidator(passwordResetValidation.resetPassword),
  validateRequest,
  performPasswordReset
);

// Two-Factor Authentication routes
router.post(
  "/enable-2fa",
  protect,
  sanitizeBody,
  createValidator(twoFactorValidation.setup),
  validateRequest,
  enable2FA
);
router.post(
  "/disable-2fa",
  protect,
  sanitizeBody,
  createValidator(twoFactorValidation.disable),
  validateRequest,
  disable2FA
);

// Profile picture upload route
router.post(
  "/upload-profile-picture",
  protect,
  upload.single("profilePicture"),
  uploadProfilePic
);

// Notification routes
router.get("/notifications", protect, getNotifications);

router.patch("/notifications/:id/read", protect, markAsRead);

router.delete("/notifications/:id", protect, deleteNotificationHandler);

// Two-Factor Setup routes
router.post("/two-factor/setup", protect, setupTwoFactorAuth);

router.post(
  "/two-factor/enable",
  protect,
  createValidator(twoFactorValidation.enable),
  validateRequest,
  enableTwoFactorAuth
);

router.post(
  "/two-factor/disable",
  protect,
  createValidator(twoFactorValidation.disable),
  validateRequest,
  disableTwoFactorAuth
);

export default router;
