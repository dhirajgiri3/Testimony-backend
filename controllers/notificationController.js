import asyncHandler from "express-async-handler";

/**
 * Get user notifications with pagination
 * @route   GET /api/v1/users/notifications
 * @access  Protected
 */
export const getNotifications = asyncHandler(async (req, res) => {
    const notifications = await Notification.find({ user: req.user.id })
        .sort({ createdAt: -1 })
        .limit(50);

    res.status(200).json({
        success: true,
        data: notifications
    });
});

/**
 * Mark notification as read
 * @route   PATCH /api/v1/users/notifications/:id/read
 * @access  Protected
 */
export const markAsRead = asyncHandler(async (req, res) => {
    const notification = await Notification.findOne({
        _id: req.params.id,
        user: req.user.id
    });

    if (!notification) {
        throw new AppError('Notification not found', 404);
    }

    notification.isRead = true;
    await notification.save();

    res.status(200).json({
        success: true,
        message: 'Notification marked as read'
    });
});

/**
 * Delete notification
 * @route   DELETE /api/v1/users/notifications/:id
 * @access  Protected
 */
export const deleteNotificationHandler = asyncHandler(async (req, res) => {
    const notification = await Notification.findOneAndDelete({
        _id: req.params.id,
        user: req.user.id
    });

    if (!notification) {
        throw new AppError('Notification not found', 404);
    }

    res.status(200).json({
        success: true,
        message: 'Notification deleted successfully'
    });
});
