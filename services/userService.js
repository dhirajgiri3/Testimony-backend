// src/services/userService.js

import User from '../models/User.js';
import UserPreference from '../models/UserPreference.js';
import UserSetting from '../models/UserSetting.js';
import AppError from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import {
  sanitizeInput,
  validatePasswordStrength,
  normalizeEmail,
} from '../utils/inputValidation.js';
import ActivityLog from '../models/ActivityLog.js';
import { sendEmail } from '../config/email.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { withTransaction } from '../utils/transaction.js'; // Ensure this utility exists
import Testimonial from '../models/Testimonial.js'; // Added missing import

/**
 * Retrieve the current user's information.
 */
export const getCurrentUserService = async (userId) => {
  const user = await User.findById(userId).select('-password');
  if (!user) {
    throw new AppError('User not found.', 404);
  }
  return user;
};

/**
 * Retrieve a user by their ID, including preferences and settings.
 */
export const getUserById = async (userId) => {
  const user = await User.findById(userId)
    .select('-password')
    .populate('preferences')
    .populate('settings');

  if (!user) {
    throw new AppError('User not found.', 404);
  }
  return user;
};

/**
 * Update user profile with enhanced validation and security.
 */
export const updateUserProfile = async (userId, updateData) => {
  try {
    const updatedFields = {};
    const sensitiveFieldsChanged = new Set();

    if (updateData.firstName) {
      updatedFields.firstName = sanitizeInput(updateData.firstName.trim());
    }
    if (updateData.lastName) {
      updatedFields.lastName = sanitizeInput(updateData.lastName.trim());
    }

    if (updateData.email && updateData.email !== updateData.currentEmail) {
      const normalizedEmail = normalizeEmail(updateData.email);
      if (!normalizedEmail) {
        throw new AppError('Invalid email format.', 400);
      }

      const emailExists = await User.findOne({ email: normalizedEmail });
      if (emailExists) {
        throw new AppError('Email already in use.', 400);
      }

      updatedFields.email = normalizedEmail;
      updatedFields.isEmailVerified = false;
      sensitiveFieldsChanged.add('email');

      const verificationToken = nanoid(32);
      updatedFields.emailVerificationToken = crypto
        .createHash('sha256')
        .update(verificationToken)
        .digest('hex');
      updatedFields.emailVerificationTokenExpiry =
        Date.now() + 24 * 60 * 60 * 1000;

      const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}`;
      await sendEmail({
        to: normalizedEmail,
        subject: 'Verify Your Email',
        template: 'emailVerification',
        context: { verificationUrl },
      });
    }

    if (updateData.phone && updateData.phone !== updateData.currentPhone) {
      const normalizedPhone = sanitizeInput(updateData.phone.trim());
      const phoneExists = await User.findOne({ phone: normalizedPhone });
      if (phoneExists) {
        throw new AppError('Phone number already in use.', 400);
      }
      updatedFields.phone = normalizedPhone;
      updatedFields.isPhoneVerified = false;
      sensitiveFieldsChanged.add('phone');
    }

    if (updateData.password) {
      validatePasswordStrength(updateData.password);
      const hashedPassword = await bcrypt.hash(updateData.password, 12);
      updatedFields.password = hashedPassword;
      sensitiveFieldsChanged.add('password');
    }

    if (updateData.bio) {
      updatedFields.bio = sanitizeInput(updateData.bio.trim());
    }
    if (updateData.location) {
      updatedFields.location = sanitizeInput(updateData.location.trim());
    }
    if (updateData.socialLinks) {
      updatedFields.socialLinks = sanitizeInput(updateData.socialLinks);
    }
    if (updateData.skills && Array.isArray(updateData.skills)) {
      updatedFields.skills = updateData.skills.map((skill) =>
        sanitizeInput(skill)
      );
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        ...updatedFields,
        lastUpdated: Date.now(),
      },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      throw new AppError('User not found.', 404);
    }

    await ActivityLog.create({
      user: userId,
      action: 'PROFILE_UPDATE',
      details: {
        sensitiveFieldsChanged: Array.from(sensitiveFieldsChanged),
        fieldsUpdated: Object.keys(updatedFields),
      },
    });

    logger.info(`User profile updated for user ${userId}.`, {
      fieldsUpdated: Object.keys(updatedFields),
    });

    return user;
  } catch (error) {
    logger.error(`Error updating user profile for user ${userId}:`, error);
    throw error instanceof AppError
      ? error
      : new AppError('Failed to update user profile.', 500);
  }
};

/**
 * Update user preferences.
 */
export const updateUserPreferences = async (userId, preferences) => {
  try {
    let userPrefs = await UserPreference.findOne({ user: userId });

    if (!userPrefs) {
      userPrefs = new UserPreference({ user: userId });
    }

    if (preferences.notifications) {
      userPrefs.notifications = {
        ...userPrefs.notifications,
        ...preferences.notifications,
      };
    }

    if (preferences.privacy) {
      userPrefs.privacy = {
        ...userPrefs.privacy,
        ...preferences.privacy,
      };
    }

    if (preferences.display) {
      userPrefs.display = {
        ...userPrefs.display,
        ...preferences.display,
      };
    }

    await userPrefs.save();

    await ActivityLog.create({
      user: userId,
      action: 'PREFERENCES_UPDATED',
      details: {
        updatedFields: Object.keys(preferences),
      },
    });

    logger.info(`User preferences updated for user ${userId}.`, {
      updatedFields: Object.keys(preferences),
    });

    return userPrefs;
  } catch (error) {
    logger.error(`Error updating preferences for user ${userId}:`, error);
    throw new AppError('Failed to update preferences.', 500);
  }
};

/**
 * Update user settings.
 */
export const updateUserSettings = async (userId, settings) => {
  try {
    let userSettings = await UserSetting.findOne({ user: userId });

    if (!userSettings) {
      userSettings = new UserSetting({ user: userId });
    }

    if (settings.language) {
      userSettings.language = sanitizeInput(settings.language.trim());
    }

    if (settings.timezone) {
      userSettings.timezone = sanitizeInput(settings.timezone.trim());
    }

    if (settings.dateFormat) {
      userSettings.dateFormat = sanitizeInput(settings.dateFormat.trim());
    }
    if (settings.timeFormat) {
      userSettings.timeFormat = sanitizeInput(settings.timeFormat.trim());
    }
    if (settings.currency) {
      userSettings.currency = sanitizeInput(settings.currency.trim());
    }

    await userSettings.save();

    await ActivityLog.create({
      user: userId,
      action: 'SETTINGS_UPDATED',
      details: {
        updatedFields: Object.keys(settings),
      },
    });

    logger.info(`User settings updated for user ${userId}.`, {
      updatedFields: Object.keys(settings),
    });

    return userSettings;
  } catch (error) {
    logger.error(`Error updating settings for user ${userId}:`, error);
    throw new AppError('Failed to update settings.', 500);
  }
};

/**
 * Delete user account with comprehensive data cleanup.
 */
export const deleteUserAccount = async (userId) => {
  return withTransaction(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new AppError('User not found.', 404);
    }

    await UserPreference.deleteOne({ user: userId }).session(session);
    await UserSetting.deleteOne({ user: userId }).session(session);

    await ActivityLog.updateMany(
      { user: userId },
      { $set: { archived: true, archivedAt: Date.now() } }
    ).session(session);

    await user.remove({ session });

    await ActivityLog.create(
      [
        {
          user: userId,
          action: 'ACCOUNT_DELETED',
          details: { timestamp: Date.now() },
        },
      ],
      { session }
    );

    trackMetric('user.account_deleted', 1, { userId });

    logger.info(`User account deleted: ${userId}`);

    return { message: 'User account deleted successfully.' };
  });
};

/**
 * Export user data for GDPR compliance.
 */
export const exportUserData = async (userId) => {
  try {
    const user = await User.findById(userId).select('-password').lean();
    const testimonials = await Testimonial.find({ seeker: userId }).lean();

    const data = {
      user,
      testimonials,
    };

    await ActivityLog.create({
      user: userId,
      action: 'USER_DATA_EXPORTED',
      details: { timestamp: Date.now() },
    });

    trackMetric('user.data_exported', 1, { userId });

    logger.info(`User data exported for user ${userId}.`);

    return data;
  } catch (error) {
    logger.error(`Error exporting data for user ${userId}:`, error);
    throw new AppError('Failed to export user data.', 500);
  }
};

/**
 * Initiate password reset by sending a reset email.
 */
export const initiatePasswordReset = async (email) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new AppError('Invalid email format.', 400);
  }

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    throw new AppError('User with this email does not exist.', 404);
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenHash = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  user.passwordResetToken = resetTokenHash;
  user.passwordResetTokenExpiry = Date.now() + 60 * 60 * 1000;
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
  await sendEmail({
    to: normalizedEmail,
    subject: 'Password Reset Request',
    template: 'passwordReset',
    context: { resetUrl },
  });

  await ActivityLog.create({
    user: user._id,
    action: 'PASSWORD_RESET_REQUEST',
    details: {
      ip: user.lastLoginIP || 'Unknown',
      userAgent: user.lastLoginUserAgent || 'Unknown',
    },
  });

  logger.info(`Password reset initiated for user ${user._id}.`);
};

/**
 * Complete password reset by updating the user's password.
 */
export const resetPassword = async (token, newPassword) => {
  const resetTokenHash = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: resetTokenHash,
    passwordResetTokenExpiry: { $gt: Date.now() },
  });

  if (!user) {
    throw new AppError('Invalid or expired password reset token.', 400);
  }

  validatePasswordStrength(newPassword);

  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetTokenExpiry = undefined;
  await user.save();

  await ActivityLog.create({
    user: user._id,
    action: 'PASSWORD_RESET',
    details: {
      ip: user.lastLoginIP || 'Unknown',
      userAgent: user.lastLoginUserAgent || 'Unknown',
    },
  });

  logger.info(`Password reset successful for user ${user._id}.`);
  return user;
};

/**
 * Upload profile picture for a user.
 */
export const uploadProfilePicture = async (userId, imageBuffer, imageType) => {
  try {
    const imageUrl = await uploadToS3(
      imageBuffer,
      imageType,
      `profiles/${userId}`
    );

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found.', 404);
    }

    user.profilePicture = imageUrl;
    await user.save();

    await ActivityLog.create({
      user: userId,
      action: 'PROFILE_PICTURE_UPDATED',
      details: { imageUrl },
    });

    trackMetric('user.profile_picture_uploaded', 1, { userId });

    logger.info(`Profile picture updated for user ${userId}.`);

    return imageUrl;
  } catch (error) {
    logger.error(`Error uploading profile picture for user ${userId}:`, error);
    throw new AppError('Failed to upload profile picture.', 500);
  }
};

/**
 * Deactivate a user's account.
 */
export const deactivateUserAccount = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found.', 404);
    }

    if (!user.isActive) {
      throw new AppError('User account is already deactivated.', 400);
    }

    user.isActive = false;
    await user.save();

    await ActivityLog.create({
      user: userId,
      action: 'ACCOUNT_DEACTIVATED',
      details: { timestamp: Date.now() },
    });

    trackMetric('user.account_deactivated', 1, { userId });

    logger.info(`User account deactivated: ${userId}.`);

    return { message: 'User account deactivated successfully.' };
  } catch (error) {
    logger.error(`Error deactivating user account ${userId}:`, error);
    throw new AppError('Failed to deactivate account.', 500);
  }
};

/**
 * Reactivate a user's account.
 */
export const reactivateUserAccount = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found.', 404);
    }

    if (user.isActive) {
      throw new AppError('User account is already active.', 400);
    }

    user.isActive = true;
    await user.save();

    await ActivityLog.create({
      user: userId,
      action: 'ACCOUNT_REACTIVATED',
      details: { timestamp: Date.now() },
    });

    trackMetric('user.account_reactivated', 1, { userId });

    logger.info(`User account reactivated: ${userId}.`);

    return { message: 'User account reactivated successfully.' };
  } catch (error) {
    logger.error(`Error reactivating user account ${userId}:`, error);
    throw new AppError('Failed to reactivate account.', 500);
  }
};

/**
 * Perform password reset by updating the user's password.
 */
export const performPasswordReset = async (
  userId,
  currentPassword,
  newPassword
) => {
  try {
    const user = await User.findById(userId).select('+password');
    if (!user) {
      throw new AppError('User not found.', 404);
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new AppError('Current password is incorrect.', 400);
    }

    validatePasswordStrength(newPassword);

    user.password = newPassword;
    await user.save();

    await ActivityLog.create({
      user: userId,
      action: 'PASSWORD_RESET',
      details: {
        ip: user.lastLoginIP || 'Unknown',
        userAgent: user.lastLoginUserAgent || 'Unknown',
      },
    });

    trackMetric('user.password_reset', 1, { userId });

    logger.info(`Password reset successful for user ${userId}.`);

    return user;
  } catch (error) {
    logger.error(`Error resetting password for user ${userId}:`, error);
    throw error instanceof AppError
      ? error
      : new AppError('Failed to reset password.', 500);
  }
};

/**
 * Helper function to upload files to S3 or another storage service.
 */
const uploadToS3 = async (buffer, mimeType, key) => {
  try {
    // Implement actual upload logic
    return `https://s3.amazonaws.com/${process.env.AWS_S3_BUCKET}/${key}`;
  } catch (error) {
    logger.error('S3 upload failed:', error);
    throw new AppError('Failed to upload file.', 500);
  }
};

/**
 * Track application metrics.
 */
const trackMetric = (name, value = 1, tags = {}) => {
  try {
    logger.info(`Metric tracked: ${name}`, { value, tags });
  } catch (error) {
    logger.warn(`Failed to track metric ${name}:`, error);
  }
};

export default {
  getCurrentUserService,
  getUserById,
  updateUserProfile,
  updateUserPreferences,
  updateUserSettings,
  deleteUserAccount,
  exportUserData,
  initiatePasswordReset,
  resetPassword,
  uploadProfilePicture,
  deactivateUserAccount,
  reactivateUserAccount,
  performPasswordReset,
};
