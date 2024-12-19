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
} from "../../../controllers/authController.js";
import passport from "passport";

// Initialize Passport configuration
import "../../../config/passport.js"; // Passport configuration file
import { protect } from "../../../middlewares/auth.js";

const router = express.Router();

// Registration route
router.post("/register", register);

// Email verification route
router.get("/verify-email/:token", verifyEmail);

// Resend verification email
router.post("/resend-verification", resendVerificationEmail);

// Login route
router.post("/login", login);

// Refresh token route
router.post("/refresh-token", refreshTokenController);

// Logout route
router.post("/logout", protect, logout);

// Send OTP route
router.post("/send-otp", sendPhoneOTP);

// Verify OTP route
router.post("/verify-otp", verifyPhoneOTP);

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
  async (req, res) => {
    // Handle successful authentication
    // Redirect or respond with tokens as needed
  }
);

export default router;
