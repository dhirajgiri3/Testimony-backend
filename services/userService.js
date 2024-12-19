// src/services/userService.js

import User from "../models/User.js";
import AppError from "../utils/appError.js";
import { logger } from "../utils/logger.js";
import { createHash } from 'crypto';
import ActivityLog from "../models/ActivityLog.js";
import UserPreference from "../models/UserPreference.js";
import UserSetting from "../models/UserSetting.js";
import crypto from 'crypto';
import { sendEmail } from "../config/email.js";
import { validatePasswordStrength } from "../utils/inputValidation.js";

/**
 * Get current user
 * @param {string} userId
 * @returns {Object} user
 */
export const getCurrentUserService = async (userId) => {
  const user = await User.findById(userId).select("-password");
  if (!user) {
    throw new AppError("User not found", 404);
  }
  return user;
};

/**
 * Get user by ID with preferences and settings
 */
export const getUserById = async (userId) => {
  const user = await User.findById(userId)
    .select("-password")
    .populate("preferences")
    .populate("settings");
  
  if (!user) {
    throw new AppError("User not found", 404);
  }
  return user;
};

/**
 * Update user profile with advanced validation
 */
export const updateUserProfile = async (userId, updateData) => {
  try {
    const updatedFields = {};
    const sensitiveFieldsChanged = new Set();

    // Handle name updates
    if (updateData.firstName) updatedFields.firstName = updateData.firstName.trim();
    if (updateData.lastName) updatedFields.lastName = updateData.lastName.trim();

    // Handle email update with verification
    if (updateData.email && updateData.email !== updateData.currentEmail) {
      const emailExists = await User.findOne({ email: updateData.email.toLowerCase() });
      if (emailExists) {
        throw new AppError("Email already in use", 400);
      }
      updatedFields.email = updateData.email.toLowerCase();
      updatedFields.isEmailVerified = false;
      sensitiveFieldsChanged.add('email');
      
      const verificationToken = generateVerificationToken();
      updatedFields.emailVerificationToken = verificationToken.hash;
      updatedFields.emailVerificationTokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
      
      // Send verification email
      await sendVerificationEmail(updateData.email, verificationToken.token);
    }

    // Handle phone update with verification
    if (updateData.phone && updateData.phone !== updateData.currentPhone) {
      const phoneExists = await User.findOne({ phone: updateData.phone });
      if (phoneExists) {
        throw new AppError("Phone number already in use", 400);
      }
      updatedFields.phone = updateData.phone;
      updatedFields.isPhoneVerified = false;
      sensitiveFieldsChanged.add('phone');
    }

    // Handle password update with strength validation
    if (updateData.password) {
      validatePasswordStrength(updateData.password);
      updatedFields.password = await bcrypt.hash(updateData.password, 12);
      sensitiveFieldsChanged.add('password');
    }

    // Handle profile enhancements
    if (updateData.bio) updatedFields.bio = updateData.bio;
    if (updateData.location) updatedFields.location = updateData.location;
    if (updateData.socialLinks) updatedFields.socialLinks = updateData.socialLinks;
    if (updateData.skills) updatedFields.skills = updateData.skills;

    const user = await User.findByIdAndUpdate(
      userId,
      { 
        ...updatedFields,
        lastUpdated: Date.now()
      },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password");

    if (!user) {
      throw new AppError("User not found", 404);
    }

    // Log profile updates
    await ActivityLog.create({
      user: userId,
      action: "PROFILE_UPDATE",
      details: {
        sensitiveFieldsChanged: Array.from(sensitiveFieldsChanged),
        fieldsUpdated: Object.keys(updatedFields)
      }
    });

    return user;
  } catch (error) {
    logger.error("Error updating user profile:", error);
    throw error;
  }
};

/**
 * Update user preferences
 */
export const updateUserPreferences = async (userId, preferences) => {
  try {
    let userPrefs = await UserPreference.findOne({ user: userId });
    
    if (!userPrefs) {
      userPrefs = new UserPreference({ user: userId });
    }

    // Update notification preferences
    if (preferences.notifications) {
      userPrefs.notifications = {
        ...userPrefs.notifications,
        ...preferences.notifications
      };
    }

    // Update privacy preferences
    if (preferences.privacy) {
      userPrefs.privacy = {
        ...userPrefs.privacy,
        ...preferences.privacy
      };
    }

    // Update display preferences
    if (preferences.display) {
      userPrefs.display = {
        ...userPrefs.display,
        ...preferences.display
      };
    }

    await userPrefs.save();
    return userPrefs;
  } catch (error) {
    logger.error("Error updating user preferences:", error);
    throw new AppError("Failed to update preferences", 500);
  }
};

/**
 * Update user settings
 */
export const updateUserSettings = async (userId, settings) => {
  try {
    let userSettings = await UserSetting.findOne({ user: userId });
    
    if (!userSettings) {
      userSettings = new UserSetting({ user: userId });
    }

    // Update language settings
    if (settings.language) {
      userSettings.language = settings.language;
    }

    // Update timezone settings
    if (settings.timezone) {
      userSettings.timezone = settings.timezone;
    }

    // Update other settings
    if (settings.dateFormat) userSettings.dateFormat = settings.dateFormat;
    if (settings.timeFormat) userSettings.timeFormat = settings.timeFormat;
    if (settings.currency) userSettings.currency = settings.currency;

    await userSettings.save();
    return userSettings;
  } catch (error) {
    logger.error("Error updating user settings:", error);
    throw new AppError("Failed to update settings", 500);
  }
};

/**
 * Delete user account with data cleanup
 */
export const deleteUserAccount = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    // Start transaction for data cleanup
    const session = await User.startSession();
    session.startTransaction();

    try {
      // Remove user preferences
      await UserPreference.deleteOne({ user: userId }).session(session);
      
      // Remove user settings
      await UserSetting.deleteOne({ user: userId }).session(session);
      
      // Archive activity logs
      await ActivityLog.updateMany(
        { user: userId },
        { $set: { archived: true, archivedAt: new Date() } }
      ).session(session);

      // Remove user
      await user.remove({ session });

      // Commit transaction
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

    // Log account deletion
    logger.info(`User account deleted: ${userId}`);
  } catch (error) {
    logger.error("Error deleting user account:", error);
    throw new AppError("Failed to delete account", 500);
  }
};

/**
 * Export user data (GDPR)
 * @param {string} userId
 * @returns {Object} user data
 */
export const exportUserData = async (userId) => {
  const user = await User.findById(userId).select("-password");
  const testimonials = await Testimonial.find({ seeker: userId });

  const data = {
    user,
    testimonials,
  };

  // Optionally, store the export data in a file or S3 and provide a link

  return data;
};

// Helper functions
const generateVerificationToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
};

const sendVerificationEmail = async (email, token) => {
  const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
  
  await sendEmail({
    to: email,
    subject: 'Verify Your Email',
    template: 'emailVerification',
    context: {
      verificationUrl
    }
  });
};

/**
 * Initiate password reset
 * @param {string} email
 * @returns {void}
 */
export const initiatePasswordReset = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new AppError("User with this email does not exist", 404);
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

  user.passwordResetToken = resetTokenHash;
  user.passwordResetTokenExpiry = Date.now() + 60 * 60 * 1000; // 1 hour
  await user.save({ validateBeforeSave: false });

  // Send reset email
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
  
  await sendEmail({
    to: user.email,
    subject: 'Password Reset Request',
    template: 'passwordReset',
    context: {
      resetUrl
    }
  });

  // Log the password reset request
  await ActivityLog.create({
    user: user.id,
    action: "PASSWORD_RESET_REQUEST",
    details: {
      ip: user.lastLoginIP || 'Unknown',
      userAgent: user.lastLoginUserAgent || 'Unknown'
    }
  });

  logger.info(`Password reset initiated for user: ${user.id}`);
};

/**
 * Complete password reset
 * @param {string} token
 * @param {string} newPassword
 * @returns {Object} updated user
 */
export const resetPassword = async (token, newPassword) => {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  const user = await User.findOne({
    passwordResetToken: tokenHash,
    passwordResetTokenExpiry: { $gt: Date.now() }
  });

  if (!user) {
    throw new AppError("Invalid or expired password reset token", 400);
  }

  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetTokenExpiry = undefined;
  await user.save();

  // Log the password reset
  await ActivityLog.create({
    user: user.id,
    action: "PASSWORD_RESET",
    details: {
      ip: user.lastLoginIP || 'Unknown',
      userAgent: user.lastLoginUserAgent || 'Unknown'
    }
  });

  logger.info(`Password reset successful for user: ${user.id}`);
  return user;
};

/**
 * Enable Two-Factor Authentication (2FA)
 * @param {string} userId
 * @param {string} method
 * @returns {void}
 */
export const enableTwoFactorAuth = async (userId, method) => {
  const user = await User.findById(userId);
  
  if (!user) {
    throw new AppError("User not found", 404);
  }

  user.twoFactorEnabled = true;
  user.twoFactorMethod = method;
  await user.save();

  // Log the 2FA setup
  await ActivityLog.create({
    user: userId,
    action: "TWO_FACTOR_ENABLED",
    details: { method }
  });

  logger.info(`Two-Factor Authentication enabled for user: ${userId}`);
};

/**
 * Disable Two-Factor Authentication (2FA)
 * @param {string} userId
 * @returns {void}
 */
export const disableTwoFactorAuth = async (userId) => {
  const user = await User.findById(userId);
  
  if (!user) {
    throw new AppError("User not found", 404);
  }

  user.twoFactorEnabled = false;
  user.twoFactorMethod = undefined;
  await user.save();

  // Log the 2FA disable
  await ActivityLog.create({
    user: userId,
    action: "TWO_FACTOR_DISABLED",
    details: {}
  });

  logger.info(`Two-Factor Authentication disabled for user: ${userId}`);
};

/**
 * Upload profile picture
 * @param {string} userId
 * @param {Buffer} imageBuffer
 * @param {string} imageType
 * @returns {string} imageUrl
 */
export const uploadProfilePicture = async (userId, imageBuffer, imageType) => {
  // Implement image upload logic, e.g., upload to S3
  const imageUrl = await uploadToS3(imageBuffer, imageType, `profiles/${userId}`);

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  user.profilePicture = imageUrl;
  await user.save();

  // Log the profile picture update
  await ActivityLog.create({
    user: userId,
    action: "PROFILE_PICTURE_UPDATED",
    details: { imageUrl }
  });

  logger.info(`Profile picture updated for user: ${userId}`);
  return imageUrl;
};
