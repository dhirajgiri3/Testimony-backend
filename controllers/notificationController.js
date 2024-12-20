// src/controllers/notificationController.js

import asyncHandler from 'express-async-handler';
import Notification from '../models/Notification.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

/**
 * Get user notifications with pagination and filtering
 * @route GET /api/v1/users/notifications
 * @access Private
 */
export const getNotifications = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, isRead, type } = req.query;

  const filters = { user: req.user.id };

  if (isRead !== undefined) {
    filters.isRead = isRead === 'true';
  }

  if (type) {
    filters.type = type;
  }

  try {
    const notifications = await Notification.find(filters)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit, 10))
      .lean();

    const total = await Notification.countDocuments(filters);

    res.status(200).json({
      success: true,
      count: notifications.length,
      total,
      page: parseInt(page, 10),
      pages: Math.ceil(total / limit),
      data: notifications,
    });
  } catch (error) {
    logger.error('❌ Error fetching notifications:', { error: error.message });
    throw new AppError('Failed to fetch notifications', 500);
  }
});

/**
 * Mark notification as read
 * @route PATCH /api/v1/users/notifications/:id/read
 * @access Private
 */
export const markAsRead = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  try {
    const notification = await Notification.findOne({
      _id: id,
      user: req.user.id,
    });

    if (!notification) {
      throw new AppError('Notification not found', 404);
    }

    if (notification.isRead) {
      return res.status(200).json({
        success: true,
        message: 'Notification is already marked as read',
      });
    }

    notification.isRead = true;
    await notification.save();

    // Log notification read activity
    await logUserActivity(req.user.id, 'MARK_NOTIFICATION_AS_READ', {
      notificationId: id,
    });

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
    });
  } catch (error) {
    logger.error('❌ Error marking notification as read:', {
      error: error.message,
    });
    throw new AppError('Failed to mark notification as read', 500);
  }
});

/**
 * Delete notification
 * @route DELETE /api/v1/users/notifications/:id
 * @access Private
 */
export const deleteNotificationHandler = asyncHandler(
  async (req, res, next) => {
    const { id } = req.params;

    try {
      const notification = await Notification.findOneAndDelete({
        _id: id,
        user: req.user.id,
      });

      if (!notification) {
        throw new AppError('Notification not found', 404);
      }

      // Log notification deletion activity
      await logUserActivity(req.user.id, 'DELETE_NOTIFICATION', {
        notificationId: id,
      });

      res.status(200).json({
        success: true,
        message: 'Notification deleted successfully',
      });
    } catch (error) {
      logger.error('❌ Error deleting notification:', { error: error.message });
      throw new AppError('Failed to delete notification', 500);
    }
  }
);

/**
 * Helper function to log user activities
 * Ensure this function is imported or defined appropriately
 */
import { logUserActivity } from '../services/activityLogService.js';

export default {
  getNotifications,
  markAsRead,
  deleteNotificationHandler,
};
