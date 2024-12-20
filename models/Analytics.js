// src/models/Analytics.js

import mongoose from 'mongoose';

const engagementSchema = new mongoose.Schema({
  testimonies: {
    total: { type: Number, default: 0 },
    published: { type: Number, default: 0 },
    draft: { type: Number, default: 0 },
    deleted: { type: Number, default: 0 },
    reported: { type: Number, default: 0 },
    averageLength: { type: Number, default: 0 },
    topCategories: [{
      category: String,
      count: Number
    }]
  },
  interactions: {
    receivedLikes: { type: Number, default: 0 },
    givenLikes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    prayers: { type: Number, default: 0 },
    bookmarks: { type: Number, default: 0 }
  },
  community: {
    followers: { type: Number, default: 0 },
    following: { type: Number, default: 0 },
    connections: { type: Number, default: 0 },
    messagesSent: { type: Number, default: 0 },
    messagesReceived: { type: Number, default: 0 }
  }
});

const contentAnalysisSchema = new mongoose.Schema({
  topics: [{
    name: String,
    frequency: Number,
    engagement: Number
  }],
  sentiment: {
    overall: { type: Number, default: 0 },
    monthly: [{
      month: String,
      score: Number,
      volume: Number
    }],
    emotions: {
      joy: { type: Number, default: 0 },
      gratitude: { type: Number, default: 0 },
      faith: { type: Number, default: 0 },
      hope: { type: Number, default: 0 },
      concern: { type: Number, default: 0 }
    }
  }
});

const reachMetricsSchema = new mongoose.Schema({
  totalViews: { type: Number, default: 0 },
  uniqueVisitors: { type: Number, default: 0 },
  geographicReach: [{
    country: String,
    views: Number,
    engagement: Number
  }],
  deviceStats: {
    mobile: { type: Number, default: 0 },
    desktop: { type: Number, default: 0 },
    tablet: { type: Number, default: 0 }
  }
});

const growthMetricsSchema = new mongoose.Schema({
  weekly: [{
    week: String,
    newTestimonies: Number,
    newFollowers: Number,
    engagement: Number
  }],
  monthly: [{
    month: String,
    testimonies: Number,
    followers: Number,
    engagement: Number
  }]
});

const prayerAnalyticsSchema = new mongoose.Schema({
  requestsSent: { type: Number, default: 0 },
  requestsReceived: { type: Number, default: 0 },
  answeredPrayers: { type: Number, default: 0 },
  prayerPartners: { type: Number, default: 0 },
  categories: [{
    category: String,
    count: Number
  }]
});

const userActivitySchema = new mongoose.Schema({
  lastActive: Date,
  loginFrequency: { type: Number, default: 0 },
  activeTimePerVisit: { type: Number, default: 0 }, // in minutes
  activityLog: [{
    action: {
      type: String,
      enum: ['POST', 'COMMENT', 'LIKE', 'SHARE', 'PRAY', 'CONNECT']
    },
    timestamp: Date,
    details: mongoose.Schema.Types.Mixed
  }]
});

const analyticsSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    engagement: engagementSchema,
    contentAnalysis: contentAnalysisSchema,
    reachMetrics: reachMetricsSchema,
    growthMetrics: growthMetricsSchema,
    prayerAnalytics: prayerAnalyticsSchema,
    userActivity: userActivitySchema
  },
  { 
    timestamps: true
  }
);

// Move index definitions out of the schema options
analyticsSchema.index({ 'engagement.testimonies.total': -1 });
analyticsSchema.index({ 'engagement.interactions.receivedLikes': -1 });
analyticsSchema.index({ 'reachMetrics.totalViews': -1 });
analyticsSchema.index({ 'userActivity.lastActive': -1 });

// Method to update engagement metrics
analyticsSchema.methods.updateEngagement = async function(type, value) {
  if (this.engagement.interactions.hasOwnProperty(type)) {
    this.engagement.interactions[type] += value;
    return await this.save();
  }
};

// Method to track user activity
analyticsSchema.methods.trackActivity = async function(action, details) {
  this.userActivity.lastActive = new Date();
  this.userActivity.activityLog.push({
    action,
    timestamp: new Date(),
    details
  });
  return await this.save();
};

const Analytics = mongoose.model('Analytics', analyticsSchema);

export default Analytics;
