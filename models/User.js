// models/User.js

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { revokeAllTokens } from '../services/tokenService.js'; // Assuming you have a token service
import speakeasy from 'speakeasy';
import { redisClient } from '../config/redis.js'; // Added missing import

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name must be less than 50 characters'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name must be less than 50 characters'],
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username must be less than 30 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please fill a valid email address',
      ],
    },
    phone: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          return /^\d{10}$/.test(v);
        },
        message: (props) => `${props.value} is not a valid phone number!`,
      },
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      select: false,
    },
    emailVerificationExpiry: {
      type: Date,
      select: false,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpiry: {
      type: Date,
      select: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    role: {
      type: String,
      enum: ['admin', 'seeker', 'giver'],
      default: 'seeker',
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    isTwoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      select: false,
    },
    notificationPreferences: {
      email: {
        testimonialApproval: { type: Boolean, default: true },
        testimonialRejection: { type: Boolean, default: true },
        testimonialVisibilityChange: { type: Boolean, default: true },
        testimonialShared: { type: Boolean, default: true },
        adminEscalations: { type: Boolean, default: true },
      },
      inApp: {
        testimonialApproval: { type: Boolean, default: true },
        testimonialRejection: { type: Boolean, default: true },
        testimonialVisibilityChange: { type: Boolean, default: true },
        testimonialShared: { type: Boolean, default: true },
        adminEscalations: { type: Boolean, default: true },
      },
    },
    isAdmin: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Password hashing middleware
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  // Hash password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);

  next();
});

// Instance method to compare passwords
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Instance method to generate email verification token
userSchema.methods.generateEmailVerificationToken = function () {
  const verificationToken = crypto.randomBytes(32).toString('hex');

  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');

  this.emailVerificationExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  return verificationToken;
};

// Instance method to verify email verification token
userSchema.methods.verifyEmailVerificationToken = function (token) {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  return (
    hashedToken === this.emailVerificationToken &&
    this.emailVerificationExpiry > Date.now()
  );
};

// Instance method to generate password reset token
userSchema.methods.generateResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(20).toString('hex');

  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  this.resetPasswordExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Instance method to verify reset password token
userSchema.methods.verifyResetPasswordToken = function (token) {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  return (
    hashedToken === this.resetPasswordToken &&
    this.resetPasswordExpiry > Date.now()
  );
};

// Instance method to generate JWT tokens
userSchema.methods.generateAuthTokens = async function () {
  const accessToken = jwt.sign(
    { id: this._id, role: this.role, tokenVersion: this.tokenVersion },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { id: this._id, role: this.role, tokenVersion: this.tokenVersion },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

// Instance method to increment token version
userSchema.methods.incrementTokenVersion = async function () {
  this.tokenVersion += 1;
  await this.save();
};

// Instance method to deactivate user
userSchema.methods.deactivate = async function () {
  this.isActive = false;
  await revokeAllTokens(this._id);
  await this.incrementTokenVersion();
  await this.save();
};

// Instance method to generate 2FA secret
userSchema.methods.generateTwoFactorSecret = function () {
  const secret = speakeasy.generateSecret();
  this.twoFactorSecret = secret.base32;
  return secret.otpauth_url;
};

// Instance method to verify 2FA token
userSchema.methods.verifyTwoFactorToken = function (token) {
  return speakeasy.totp.verify({
    secret: this.twoFactorSecret,
    encoding: 'base32',
    token,
  });
};

// Instance method to enable/disable 2FA
userSchema.methods.setTwoFactorEnabled = async function (enabled) {
  this.isTwoFactorEnabled = enabled;
  await this.save();
};

// Instance method to update notification preferences
userSchema.methods.updateNotificationPreferences = async function (preferences) {
  this.notificationPreferences = { ...this.notificationPreferences, ...preferences };
  await this.save();
};

// Rate limiter for token generation
const generateTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: 'Too many requests, please try again later.',
});

// Indexes
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);

export default User;
