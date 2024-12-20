// src/models/Notification.js

import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        message: { type: String, required: true },
        read: { type: Boolean, default: false },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        type: {
            type: String,
            enum: ['info', 'warning', 'error', 'success'],
            default: 'info',
        },
    },
    { timestamps: true }
);

// Index for efficient querying
notificationSchema.index({ user: 1, createdAt: -1 });

// Virtual field for formatted createdAt
notificationSchema.virtual('formattedCreatedAt').get(function () {
    return this.createdAt.toLocaleString();
});

// Method to mark notification as read
notificationSchema.methods.markAsRead = async function () {
    this.read = true;
    return await this.save();
};

// Static method to get unread notifications for a user
notificationSchema.statics.getUnreadNotifications = async function (userId) {
    return await this.find({ user: userId, read: false }).sort({ createdAt: -1 });
};

export default mongoose.model('Notification', notificationSchema);