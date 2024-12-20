// src/services/activityLogService.js

import ActivityLog from '../models/ActivityLog.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

/**
 * Logs a user activity with detailed metadata.
 *
 * @param {string} userId - The ID of the user performing the action.
 * @param {string} action - The type of action being performed.
 * @param {Object} [metadata={}] - Additional metadata about the action.
 * @returns {Promise<Object>} The created activity log.
 */
export const logUserActivity = async (userId, action, metadata = {}) => {
  try {
    const activityLog = await ActivityLog.create({
      user: userId,
      action,
      metadata: {
        ...metadata,
        timestamp: new Date(),
        ip: metadata.ip || 'unknown',
        userAgent: metadata.userAgent || 'unknown',
      },
    });

    logger.info(`Activity logged - User: ${userId}, Action: ${action}`);
    return activityLog;
  } catch (error) {
    logger.error(
      `Error logging activity - User: ${userId}, Action: ${action}`,
      error
    );
    throw new AppError('Failed to log user activity', 500);
  }
};

/**
 * Retrieves activity logs for a specific user with optional filters.
 *
 * @param {string} userId - The ID of the user.
 * @param {Object} [filters={}] - Filtering options (startDate, endDate, action, limit, skip).
 * @returns {Promise<Array>} Array of activity logs.
 */
export const getUserActivityLogs = async (userId, filters = {}) => {
  try {
    const query = { user: userId };

    // Apply date range filters if provided
    if (filters.startDate) {
      query.createdAt = { $gte: new Date(filters.startDate) };
    }
    if (filters.endDate) {
      query.createdAt = { ...query.createdAt, $lte: new Date(filters.endDate) };
    }

    // Apply action type filter if provided
    if (filters.action) {
      query.action = filters.action;
    }

    const logs = await ActivityLog.find(query)
      .sort({ createdAt: -1 })
      .limit(filters.limit || 100)
      .skip(filters.skip || 0);

    return logs;
  } catch (error) {
    logger.error(`Error fetching activity logs for user: ${userId}`, error);
    throw new AppError('Failed to fetch activity logs', 500);
  }
};

/**
 * Retrieves system-wide activity logs with optional filters. Intended for admin use.
 *
 * @param {Object} [filters={}] - Filtering options (userId, action, startDate, endDate, limit, skip).
 * @returns {Promise<Array>} Array of system-wide activity logs.
 */
export const getSystemActivityLogs = async (filters = {}) => {
  try {
    const query = {};

    // Apply filters
    if (filters.userId) query.user = filters.userId;
    if (filters.action) query.action = filters.action;
    if (filters.startDate) {
      query.createdAt = { $gte: new Date(filters.startDate) };
    }
    if (filters.endDate) {
      query.createdAt = { ...query.createdAt, $lte: new Date(filters.endDate) };
    }

    const logs = await ActivityLog.find(query)
      .populate('user', 'email username')
      .sort({ createdAt: -1 })
      .limit(filters.limit || 100)
      .skip(filters.skip || 0);

    return logs;
  } catch (error) {
    logger.error('Error fetching system activity logs', error);
    throw new AppError('Failed to fetch system activity logs', 500);
  }
};

/**
 * Clears old activity logs that are older than the specified number of days.
 *
 * @param {number} [daysToKeep=90] - Number of days to retain logs.
 * @returns {Promise<Object>} Result of the cleanup operation.
 */
export const clearOldActivityLogs = async (daysToKeep = 90) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await ActivityLog.deleteMany({
      createdAt: { $lt: cutoffDate },
    });

    logger.info(`Cleared ${result.deletedCount} old activity logs`);
    return result;
  } catch (error) {
    logger.error('Error clearing old activity logs', error);
    throw new AppError('Failed to clear old activity logs', 500);
  }
};

/**
 * Enum for standardized activity types.
 */
export const ActivityTypes = {
  PROFILE_UPDATE: 'PROFILE_UPDATE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  TWO_FACTOR_SETUP: 'TWO_FACTOR_SETUP',
  TWO_FACTOR_DISABLE: 'TWO_FACTOR_DISABLE',
  ACCOUNT_DEACTIVATE: 'ACCOUNT_DEACTIVATE',
  ACCOUNT_REACTIVATE: 'ACCOUNT_REACTIVATE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  FAILED_LOGIN: 'FAILED_LOGIN',
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  PREFERENCES_UPDATE: 'PREFERENCES_UPDATE',
  PROFILE_PICTURE_UPDATE: 'PROFILE_PICTURE_UPDATE',
  SKILL_ADDED: 'SKILL_ADDED',
  SKILL_REMOVED: 'SKILL_REMOVED',
  EMAIL_CHANGE: 'EMAIL_CHANGE',
  PHONE_CHANGE: 'PHONE_CHANGE',
};

const activityLogService = {
  logUserActivity,
  getUserActivityLogs,
  getSystemActivityLogs,
  clearOldActivityLogs,
  ActivityTypes,
};

export default activityLogService;
