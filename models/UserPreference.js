
import mongoose from 'mongoose';

const userPreferenceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  notifications: {
    email: {
      testimonialRequest: { type: Boolean, default: true },
      testimonialSubmission: { type: Boolean, default: true },
      weeklyDigest: { type: Boolean, default: false }
    },
    push: {
      testimonialRequest: { type: Boolean, default: true },
      testimonialSubmission: { type: Boolean, default: true },
      insights: { type: Boolean, default: false }
    }
  },
  privacy: {
    profileVisibility: {
      type: String,
      enum: ['public', 'private', 'connections'],
      default: 'public'
    },
    testimonialVisibility: {
      type: String,
      enum: ['public', 'private', 'connections'],
      default: 'public'
    },
    showEmail: { type: Boolean, default: false },
    showPhone: { type: Boolean, default: false }
  },
  display: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system'
    },
    compactView: { type: Boolean, default: false },
    showAvatars: { type: Boolean, default: true }
  }
}, {
  timestamps: true
});

export default mongoose.model('UserPreference', userPreferenceSchema);