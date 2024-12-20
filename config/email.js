// email.js

import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';
import { emailTemplates } from '../utils/emailTemplates.js';
import rateLimit from 'express-rate-limit';

// Create email transporter using Mailtrap
const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST,
  port: process.env.MAILTRAP_PORT,
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS,
  },
});

// Email rate limiter
const emailRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: process.env.EMAIL_RESEND_RATE_LIMIT_MAX || 5,
  message: 'Too many email requests, please try again later.',
});

// Verify transporter configuration
const verifyEmailConfiguration = async () => {
  try {
    await transporter.verify();
    logger.info('✅ Email transporter configured successfully.');
  } catch (error) {
    logger.error('❌ Email transporter configuration error:', error);
    throw new Error('Email service configuration failed.');
  }
};

// Send email with retry mechanism
const sendEmail = async (mailOptions, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      logger.info(`✅ Email sent successfully to ${mailOptions.to}`);
      return info;
    } catch (error) {
      if (attempt === retries) {
        logger.error(
          `❌ Failed to send email after ${retries} attempts:`,
          error
        );
        throw error;
      }
      logger.warn(`Email sending attempt ${attempt} failed, retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
};

// Send Verification Email
const sendVerificationEmail = async (to, token) => {
  const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  const mailOptions = {
    from: `"Testimony App" <${process.env.MAILTRAP_USER}>`,
    to,
    subject: 'Verify Your Email',
    html: emailTemplates.verifyEmail(verificationUrl),
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
    },
  };

  return sendEmail(mailOptions);
};

// Send Password Reset Email
const sendPasswordResetEmail = async (to, token) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  const mailOptions = {
    from: `"Testimony App" <${process.env.MAILTRAP_USER}>`,
    to,
    subject: 'Reset Your Password',
    html: emailTemplates.resetPassword(resetUrl),
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
    },
  };

  return sendEmail(mailOptions);
};

export {
  transporter,
  verifyEmailConfiguration,
  sendVerificationEmail,
  sendPasswordResetEmail,
  emailRateLimiter,
  sendEmail,
};
