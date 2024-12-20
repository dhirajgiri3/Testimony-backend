// src/models/Goal.js

import mongoose from 'mongoose';

const goalSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please provide a title'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters'],
  },
  description: {
    type: String,
    required: [true, 'Please provide a description'],
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters'],
  },
  category: {
    type: String,
    enum: ['spiritual', 'personal', 'community', 'ministry', 'prayer', 'study', 'other'],
    required: true,
  },
  type: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'yearly', 'custom'],
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'expired', 'paused', 'abandoned'],
    default: 'active',
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },
  progress: {
    current: { type: Number, default: 0 },
    target: { type: Number, required: true },
    unit: { type: String, default: 'percent' },
  },
  startDate: {
    type: Date,
    required: [true, 'Please provide a start date'],
  },
  deadline: {
    type: Date,
    required: [true, 'Please provide an end date'],
  },
  milestones: [{
    title: String,
    description: String,
    dueDate: {
      type: Date,
      validate: {
        validator: function(value) {
          return value >= this.startDate && value <= this.deadline;
        },
        message: 'Milestone due date must be within the start and end date range'
      }
    },
    completed: { type: Boolean, default: false },
    completedAt: Date
  }],
  accountability: {
    partners: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      role: { type: String, enum: ['mentor', 'partner', 'observer'] }
    }],
    private: { type: Boolean, default: false }
  },
  reminders: [{
    frequency: { type: String, enum: ['daily', 'weekly', 'custom'] },
    time: Date,
    enabled: { type: Boolean, default: true }
  }],
  tags: [{
    type: String,
    trim: true
  }],
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  attachedTestimonies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Testimony'
  }],
  statistics: {
    completionRate: { type: Number, default: 0 },
    streakDays: { type: Number, default: 0 },
    lastCheckin: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
goalSchema.index({ user: 1, status: 1 });
goalSchema.index({ deadline: 1 });

// Pre-save validation to ensure deadline is after startDate
goalSchema.pre('save', function(next) {
  if (this.deadline < this.startDate) {
    return next(new Error('Deadline must be after the start date'));
  }
  next();
});

// Methods
goalSchema.methods.updateProgress = async function(progress) {
  this.progress.current = progress;
  if (progress >= this.progress.target) {
    this.status = 'completed';
  }
  return this.save();
};

goalSchema.methods.addMilestone = async function(milestone) {
  this.milestones.push(milestone);
  return this.save();
};

goalSchema.methods.toggleReminder = async function(reminderId, enabled) {
  const reminder = this.reminders.id(reminderId);
  if (reminder) {
    reminder.enabled = enabled;
    return this.save();
  }
  return null;
};

// Virtuals
goalSchema.virtual('daysRemaining').get(function() {
  return Math.ceil((this.deadline - new Date()) / (1000 * 60 * 60 * 24));
});

goalSchema.virtual('isOverdue').get(function() {
  return this.status !== 'completed' && this.deadline < new Date();
});

const Goal = mongoose.model('Goal', goalSchema);

export default Goal;
