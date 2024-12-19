// src/routes/api/v1/auth.js

import express from "express";
import {
  register,
  verifyEmail,
  login,
  refreshTokenController,
  logout,
  googleAuthCallback,
  sendPhoneOTP,
  verifyPhoneOTP,
  resendVerificationEmail,
} from "../../../controllers/authController.js";
import passport from "passport";

// Initialize Passport configuration
import "../../../config/passport.js"; // Passport configuration file
import { protect, authorize } from "../../../middlewares/auth.js";

const router = express.Router();

// Registration route
router.post(
  "/register",
  register // Rate limiting and validation handled within the controller
);

// Email verification route
router.get("/verify-email/:token", verifyEmail);

// Login route
router.post(
  "/login",
  login // Rate limiting and validation handled within the controller
);

// Refresh token route
router.post("/refresh-token", refreshTokenController);

// Logout route
router.post("/logout", protect, logout);

// Send OTP route
router.post("/send-otp", sendPhoneOTP);

// Verify OTP route
router.post("/verify-otp", verifyPhoneOTP);

// Resend verification email
router.post("/resend-verification", resendVerificationEmail);

// Google OAuth routes with state parameter for CSRF protection
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"], state: true })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${process.env.CLIENT_URL}/login`,
    session: false,
  }),
  googleAuthCallback
);

export default router;
