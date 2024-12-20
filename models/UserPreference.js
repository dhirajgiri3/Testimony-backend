// models/UserPreference.js

import mongoose from 'mongoose';

const userPreferenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    notifications: {
      email: {
        testimonies: { type: Boolean, default: true },
        comments: { type: Boolean, default: true },
        mentions: { type: Boolean, default: true },
        connections: { type: Boolean, default: true },
        messages: { type: Boolean, default: true },
      },
      push: {
        testimonies: { type: Boolean, default: true },
        comments: { type: Boolean, default: true },
        mentions: { type: Boolean, default: true },
        connections: { type: Boolean, default: true },
        messages: { type: Boolean, default: true },
      },
      sms: {
        enabled: { type: Boolean, default: false },
        importantUpdates: { type: Boolean, default: true },
      },
    },
    privacy: {
      profileVisibility: {
        type: String,
        enum: ['public', 'private', 'connections'],
        default: 'public',
      },
      testimonyVisibility: {
        type: String,
        enum: ['public', 'private', 'connections'],
        default: 'public',
      },
      allowMessagesFrom: {
        type: String,
        enum: ['everyone', 'connections', 'nobody'],
        default: 'everyone',
      },
      showOnlineStatus: { type: Boolean, default: true },
      allowTagging: { type: Boolean, default: true },
    },
    content: {
      language: {
        type: String,
        default: 'en',
      },
      contentMaturity: {
        type: String,
        enum: ['all', 'moderate', 'strict'],
        default: 'moderate',
      },
      autoPlayVideos: { type: Boolean, default: true },
    },
    accessibility: {
      fontSize: {
        type: String,
        enum: ['small', 'medium', 'large'],
        default: 'medium',
      },
      highContrast: { type: Boolean, default: false },
      reducedMotion: { type: Boolean, default: false },
    },
    feed: {
      sortBy: {
        type: String,
        enum: ['recent', 'popular', 'relevant'],
        default: 'recent',
      },
      showSensitiveContent: { type: Boolean, default: false },
      topicsOfInterest: [{
        type: String,
        enum: ['faith', 'healing', 'miracles', 'prayer', 'worship', 'community'],
      }],
    }
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
userPreferenceSchema.index({ user: 1 });

// Method to update notification settings
userPreferenceSchema.methods.updateNotificationSettings = async function(type, settings) {
  const validTypes = ['email', 'push', 'sms'];
  if (!validTypes.includes(type)) {
    throw new Error('Invalid notification type');
  }
  this.notifications[type] = { ...this.notifications[type], ...settings };
  return await this.save();
};

// Method to update privacy settings
userPreferenceSchema.methods.updatePrivacySettings = async function(settings) {
  const validSettings = ['profileVisibility', 'testimonyVisibility', 'allowMessagesFrom', 'showOnlineStatus', 'allowTagging'];
  for (const key in settings) {
    if (!validSettings.includes(key)) {
      throw new Error(`Invalid privacy setting: ${key}`);
    }
  }
  this.privacy = { ...this.privacy, ...settings };
  return await this.save();
};

// Method to update multiple settings at once
userPreferenceSchema.methods.updateSettings = async function(updates) {
  for (const key in updates) {
    if (this[key] && typeof this[key] === 'object') {
      this[key] = { ...this[key], ...updates[key] };
    } else {
      this[key] = updates[key];
    }
  }
  return await this.save();
};

// Virtual field for combined notification preferences
userPreferenceSchema.virtual('combinedNotificationPreferences').get(function() {
  return {
    email: this.notifications.email,
    push: this.notifications.push,
    sms: this.notifications.sms,
  };
});

const UserPreference = mongoose.model('UserPreference', userPreferenceSchema);

export default UserPreference;