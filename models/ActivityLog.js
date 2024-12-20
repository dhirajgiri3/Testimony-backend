// src/models/ActivityLog.js

import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    actionType: {
      type: String,
      required: true,
      enum: [
        // Authentication related
        'LOGIN',
        'LOGOUT',
        'PASSWORD_CHANGE',
        'EMAIL_VERIFICATION',
        'TWO_FACTOR_SETUP',
        
        // Content related
        'TESTIMONY_CREATE',
        'TESTIMONY_UPDATE',
        'TESTIMONY_DELETE',
        'COMMENT_ADD',
        'COMMENT_DELETE',
        
        // Social interactions
        'PRAYER_REQUEST',
        'TESTIMONY_SHARE',
        'USER_FOLLOW',
        'USER_UNFOLLOW',
        'MESSAGE_SEND',
        
        // Settings & Profile
        'PROFILE_UPDATE',
        'SETTINGS_CHANGE',
        'PREFERENCES_UPDATE',
        
        // Reports & Moderation
        'CONTENT_REPORT',
        'ACCOUNT_SUSPENSION',
        'ACCOUNT_REACTIVATION'
      ]
    },
    resourceType: {
      type: String,
      enum: ['USER', 'TESTIMONY', 'COMMENT', 'MESSAGE', 'PRAYER_REQUEST', 'SETTING'],
      required: false
    },
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'resourceType',
      required: false
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      required: false
    },
    metadata: {
      ipAddress: String,
      userAgent: String,
      device: String,
      browser: String,
      operatingSystem: String,
      location: {
        country: String,
        city: String,
        coordinates: {
          type: [Number],
          default: undefined
        }
      }
    },
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'PENDING', 'BLOCKED'],
      default: 'SUCCESS'
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'LOW'
    }
  },
  { 
    timestamps: true
  }
);

// Move index definitions out of the schema options
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ actionType: 1 });
activityLogSchema.index({ 'metadata.ipAddress': 1 });
activityLogSchema.index({ status: 1 });
activityLogSchema.index({ severity: 1 });

// Method to create activity log with IP geolocation
activityLogSchema.statics.logActivity = async function(data) {
  try {
    // You can add IP geolocation logic here
    return await this.create(data);
  } catch (error) {
    console.error('Activity logging failed:', error);
  }
};

// Method to get user's recent activity
activityLogSchema.statics.getUserActivity = function(userId, limit = 10) {
  return this.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('resourceId');
};

// Method to get security events
activityLogSchema.statics.getSecurityEvents = function(userId) {
  return this.find({
    user: userId,
    actionType: {
      $in: ['LOGIN', 'LOGOUT', 'PASSWORD_CHANGE', 'TWO_FACTOR_SETUP']
    }
  }).sort({ createdAt: -1 });
};

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

export default ActivityLog;
