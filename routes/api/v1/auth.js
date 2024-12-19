// src/routes/api/v1/auth.js

import express from "express";
import {
  register,
  verifyEmail,
  resendVerificationEmail,
  login,
  refreshTokenController,
  logout,
  sendPhoneOTP,
  verifyPhoneOTP,
  forgotPassword,
  resetPasswordController,
  verifyTwoFactor,
} from "../../../controllers/authController.js";
import passport from "passport";
import "../../../config/passport.js"; // Passport configuration file
import { protect, authorize } from "../../../middlewares/auth.js";
import {
  passwordResetRateLimiter,
  emailResendRateLimiter,
  twoFactorRateLimiter,
} from "../../../middlewares/rateLimiter.js";
import validators, {
  createValidator,
  validateRequest,
} from "../../../utils/validators.js";
import { csrfProtection, attachCsrfToken } from "../../../middlewares/csrf.js";

const router = express.Router();

// Apply CSRF protection to state-changing routes
router.post(
  "/register",
  csrfProtection,
  createValidator(validators.authValidators.register),
  validateRequest,
  register
);

router.post(
  "/resend-verification",
  csrfProtection,
  protect,
  emailResendRateLimiter,
  createValidator(validators.authValidators.emailResend),
  validateRequest,
  resendVerificationEmail
);

router.post(
  "/login",
  csrfProtection,
  createValidator(validators.authValidators.login),
  validateRequest,
  login
);

router.post(
  "/verify-2fa",
  csrfProtection,
  protect,
  twoFactorRateLimiter, // Apply rate limiter
  createValidator(validators.twoFactorValidation.verify),
  validateRequest,
  verifyTwoFactor
);

router.post("/refresh-token", csrfProtection, refreshTokenController);

router.post("/logout", csrfProtection, protect, logout);

router.post(
  "/send-otp",
  csrfProtection,
  protect,
  createValidator(validators.twoFactorValidation.sendOTP),
  validateRequest,
  sendPhoneOTP
);

router.post(
  "/verify-otp",
  csrfProtection,
  protect,
  createValidator(validators.twoFactorValidation.verifyOTP),
  validateRequest,
  verifyPhoneOTP
);

router.post(
  "/password-reset-request",
  csrfProtection,
  passwordResetRateLimiter,
  createValidator(validators.authValidators.forgotPassword),
  validateRequest,
  forgotPassword
);

router.post(
  "/reset-password",
  csrfProtection,
  passwordResetRateLimiter,
  createValidator(validators.authValidators.resetPassword),
  validateRequest,
  resetPasswordController
);

// Attach CSRF token to authentication routes
router.get("/register", attachCsrfToken, (req, res) => {
  res.json({ csrfToken: res.locals.csrfToken });
});

router.get("/login", attachCsrfToken, (req, res) => {
  res.json({ csrfToken: res.locals.csrfToken });
});

// Google OAuth routes with state parameter for CSRF protection
router.get("/google", csrfProtection, (req, res, next) => {
  req.session.oauthState = crypto.randomBytes(16).toString("hex");
  passport.authenticate("google", {
    scope: ["profile", "email"],
    state: req.session.oauthState,
  })(req, res, next);
});

router.get(
  "/google/callback",
  csrfProtection,
  passport.authenticate("google", {
    failureRedirect: `${process.env.CLIENT_URL}/login`,
    session: false,
  }),
  async (req, res) => {
    res.redirect(`${process.env.CLIENT_URL}/auth/success`);
  }
);

export default router;
