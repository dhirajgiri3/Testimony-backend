// src/models/Testimonial.js

import mongoose from 'mongoose';
import { sendTestimonialRequestEmail, sendEscalationNotificationEmail } from '../services/emailService.js';
import { calculateSentimentAnalytics } from '../utils/sentimentAnalysis.js';

/**
 * Media Schema with enhanced validation and fields
 */
const mediaSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: [true, 'Media URL is required'],
      validate: {
        validator: function (v) {
          return /^(http|https):\/\/[^ "]+$/.test(v);
        },
        message: 'Invalid URL format',
      },
    },
    type: {
      type: String,
      enum: ['image', 'video', 'document', 'audio'],
      required: true,
    },
    caption: {
      type: String,
      maxlength: [200, 'Caption cannot exceed 200 characters'],
    },
    thumbnail: String,
    metadata: {
      size: Number,
      format: String,
      duration: Number,
      dimensions: {
        width: Number,
        height: Number,
      },
      lastModified: Date,
    },
  },
  { _id: false }
);

/**
 * Testimonial Schema
 */
const testimonialSchema = new mongoose.Schema(
  {
    seeker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    givers: [
      {
        email: {
          type: String,
          required: true,
          lowercase: true,
          trim: true,
          validate: {
            validator: function (v) {
              return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: 'Invalid email format',
          },
        },
        verificationToken: String,
        verificationTokenExpiry: Date,
        verificationStatus: {
          type: String,
          enum: ['pending', 'approved', 'rejected', 'expired'],
          default: 'pending',
        },
        testimonial: {
          text: String,
          rating: {
            overall: {
              type: Number,
              min: 1,
              max: 5,
            },
            skills: [Number],
          },
        },
        skills: [String],
        media: [mediaSchema],
        reminders: [
          {
            sentAt: Date,
            type: String,
            status: String,
          },
        ],
        isApproved: {
          type: Boolean,
          default: false,
        },
        approvalHistory: [
          {
            status: String,
            approvedBy: mongoose.Schema.Types.ObjectId,
            comments: String,
            approvedAt: Date,
          },
        ],
        submittedAt: Date,
      },
    ],
    projectDetails: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'approved', 'reported'],
      default: 'pending',
    },
    analytics: {
      views: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
      impressions: { type: Number, default: 0 },
      endorsements: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          date: Date,
          comment: String,
        },
      ],
      sentimentAnalysis: {
        overallSentiment: String,
        emotionScores: mongoose.Schema.Types.Mixed,
        lastUpdated: Date,
      },
      shareHistory: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          platform: String,
          timestamp: Date,
        },
      ],
      impressionSources: mongoose.Schema.Types.Mixed,
    },
    moderation: {
      status: { type: String, default: 'normal' },
      history: [
        {
          action: String,
          at: Date,
          reason: String,
        },
      ],
    },
    certificates: [
      {
        url: String,
        generatedAt: Date,
        template: String,
      },
    ],
    visibilityHistory: [
      {
        status: Boolean,
        changedBy: mongoose.Schema.Types.ObjectId,
        changedAt: Date,
        reason: String,
      },
    ],
    reports: [
      {
        reason: String,
        description: String,
        evidence: [String],
        reportedBy: String,
        reportedAt: Date,
        status: String,
        metadata: mongoose.Schema.Types.Mixed,
      },
    ],
    analysis: mongoose.Schema.Types.Mixed,
    categories: [String],
    skills: [String],
    sentimentScore: Number,
    emotionAnalysis: mongoose.Schema.Types.Mixed,
    lastUpdated: Date,
  },
  { timestamps: true }
);

// Indexes for commonly queried fields
testimonialSchema.index({ seeker: 1 });
testimonialSchema.index({ status: 1 });
testimonialSchema.index({ visibility: 1 });

/**
 * Testimonial Methods
 */
testimonialSchema.methods = {
  /**
   * Enhanced analytics update method
   * @param {string} action 
   * @param {string} userId 
   * @param {object} data 
   */
  async updateAnalytics(action, userId, data = {}) {
    try {
      const validActions = ['view', 'share', 'impression', 'endorse', 'sentiment'];
      if (!validActions.includes(action)) {
        throw new Error('Invalid analytics action');
      }

      const updates = {
        view: () => {
          this.analytics.views++;
          trackMetric('testimonial.view', 1, { testimonialId: this._id });
        },
        share: () => {
          this.analytics.shares++;
          this.analytics.shareHistory.push({
            user: userId,
            platform: data.platform,
            timestamp: new Date(),
          });
          trackMetric('testimonial.share', 1, { testimonialId: this._id, platform: data.platform });
        },
        impression: () => {
          this.analytics.impressions++;
          const source = data.source || 'direct';
          this.analytics.impressionSources[source] = (this.analytics.impressionSources[source] || 0) + 1;
          trackMetric('testimonial.impression', 1, { testimonialId: this._id, source });
        },
        endorse: () => {
          if (!this.analytics.endorsements.some(e => e.user.equals(userId))) {
            this.analytics.endorsements.push({
              user: userId,
              date: new Date(),
              comment: data.comment,
            });
            trackMetric('testimonial.endorse', 1, { testimonialId: this._id });
          }
        },
        sentiment: async () => {
          if (this.givers.some(g => g.testimonial && g.testimonial.text)) {
            const sentimentResults = await calculateSentimentAnalytics(this.givers.map(g => g.testimonial.text).join(' '));
            this.analytics.sentimentAnalysis = {
              ...sentimentResults,
              lastUpdated: new Date(),
            };
            trackMetric('testimonial.sentiment_analysis', 1, { testimonialId: this._id });
          }
        },
      };

      await updates[action]();
      return await this.save();
    } catch (error) {
      console.error('Analytics update failed:', error);
      throw error;
    }
  },

  /**
   * Enhanced reminder system with smart scheduling
   * @param {object} options 
   */
  async sendReminders(options = {}) {
    try {
      const now = new Date();
      const reminderConfig = {
        maxReminders: options.maxReminders || 3,
        intervalDays: options.intervalDays || 7,
        escalationThreshold: options.escalationThreshold || 2,
      };

      const pendingGivers = this.givers.filter(g =>
        g.verificationStatus === 'pending' || g.verificationStatus === 'expired'
      );

      for (const giver of pendingGivers) {
        const reminderCount = giver.reminders?.length || 0;
        const lastReminder = giver.reminders?.[reminderCount - 1];

        if (reminderCount >= reminderConfig.maxReminders) continue;

        const shouldSendReminder = !lastReminder ||
          (now - new Date(lastReminder.sentAt)) / (1000 * 60 * 60 * 24) >= reminderConfig.intervalDays;

        if (shouldSendReminder) {
          const reminderType = this._determineReminderType(reminderCount);
          const template = this._getReminderTemplate(reminderType, giver);

          // Send reminder email
          await sendTestimonialRequestEmail(
            giver.email,
            `${process.env.APP_URL}/verify/${giver.verificationToken}`,
            this.seeker.name,
            this.projectDetails
          );

          // Update reminder history
          giver.reminders.push({
            sentAt: now,
            type: reminderType,
            status: 'sent',
          });

          // Escalate if needed
          if (reminderCount >= reminderConfig.escalationThreshold) {
            await this._handleReminderEscalation(giver);
          }
        }
      }

      return await this.save();
    } catch (error) {
      console.error('Reminder sending failed:', error);
      throw error;
    }
  },

  /**
   * Private helper method to determine reminder type
   * @param {number} reminderCount 
   * @returns {string}
   */
  _determineReminderType(reminderCount) {
    const types = {
      0: 'initial',
      1: 'followup',
      2: 'final',
    };
    return types[reminderCount] || 'final';
  },

  /**
   * Private helper method to get reminder template
   * @param {string} type 
   * @param {object} giver 
   * @returns {object}
   */
  _getReminderTemplate(type, giver) {
    const templates = {
      initial: {
        subject: 'Request for Your Testimonial',
        name: 'initial-reminder',
      },
      followup: {
        subject: 'Friendly Reminder: Your Testimonial is Pending',
        name: 'followup-reminder',
      },
      final: {
        subject: 'Final Reminder: Testimonial Request',
        name: 'final-reminder',
      },
    };
    return templates[type];
  },

  /**
   * Private helper method to handle reminder escalation
   * @param {object} giver 
   */
  async _handleReminderEscalation(giver) {
    // Implement escalation logic (e.g., notify admin, mark as requiring attention)
    this.moderation.status = 'flagged';
    this.moderation.history.push({
      action: 'reminder_escalation',
      at: new Date(),
      reason: `Multiple reminders sent to ${giver.email} without response`,
    });
    await this.save();
    
    // Notify admin about escalation
    await sendEscalationNotificationEmail(
      giver.email,
      `Multiple reminders sent to ${giver.email} without response.`
    );
  },
};

/**
 * Static Methods
 */
testimonialSchema.statics = {
  /**
   * Find featured testimonials
   * @returns {Promise<Array>}
   */
  async findFeatured() {
    return this.find({
      'settings.featuredOnProfile': true,
      status: 'approved',
      visibility: 'public',
    })
      .sort({ 'analytics.views': -1 })
      .limit(10)
      .populate('seeker', 'firstName lastName email');
  },

  /**
   * Get testimonial statistics
   * @param {string} userId 
   * @returns {Promise<Object>}
   */
  async getStats(userId) {
    return this.aggregate([
      { $match: { seeker: mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          averageRating: {
            $avg: {
              $avg: '$givers.testimonial.rating.overall',
            },
          },
          totalViews: { $sum: '$analytics.views' },
        },
      },
    ]);
  },
};

/**
 * Metrics Tracking Helper
 * @param {string} name 
 * @param {number} value 
 * @param {object} tags 
 */
const trackMetric = (name, value = 1, tags = {}) => {
  try {
    // Assuming metrics is a global metrics utility
    metrics.increment(name, value, tags);
  } catch (error) {
    console.warn(`Failed to track metric ${name}:`, error);
  }
};

const Testimonial = mongoose.model('Testimonial', testimonialSchema);

export default Testimonial;
