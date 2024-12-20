import mongoose from 'mongoose';

const skillSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Please provide a skill name'],
    trim: true,
    maxlength: [100, 'Skill name cannot exceed 100 characters'],
  },
  category: {
    type: String,
    required: true,
    enum: [
      'ministry',
      'leadership',
      'teaching',
      'counseling',
      'worship',
      'prayer',
      'evangelism',
      'administration',
      'languages',
      'technology',
      'communication',
      'other'
    ]
  },
  proficiency: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    default: 'beginner'
  },
  endorsements: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    date: {
      type: Date,
      default: Date.now
    },
    comment: String
  }],
  experience: {
    years: {
      type: Number,
      default: 0,
      validate: {
        validator: function(value) {
          return value >= 0;
        },
        message: 'Years of experience cannot be negative'
      }
    },
    description: String,
    highlights: [String]
  },
  certifications: [{
    name: String,
    issuer: String,
    date: Date,
    verificationUrl: String
  }],
  testimonials: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Testimony'
  }],
  visibility: {
    type: String,
    enum: ['public', 'private', 'connections'],
    default: 'public'
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true
});

// Indexes
skillSchema.index({ name: 1, category: 1 });

// Virtual for total endorsements count
skillSchema.virtual('endorsementCount').get(function() {
  return this.endorsements.length;
});

// Middleware to handle cascading deletes
skillSchema.pre('remove', async function(next) {
  await this.model('Testimony').deleteMany({ _id: { $in: this.testimonials } });
  next();
});

// Method to add endorsement
skillSchema.methods.addEndorsement = async function(userId, comment) {
  if (!this.endorsements.some(e => e.user.equals(userId))) {
    this.endorsements.push({ user: userId, comment });
    return await this.save();
  }
  return this;
};

// Method to remove endorsement
skillSchema.methods.removeEndorsement = async function(userId) {
  this.endorsements = this.endorsements.filter(e => !e.user.equals(userId));
  return await this.save();
};

// Method to update proficiency
skillSchema.methods.updateProficiency = async function(level) {
  if (['beginner', 'intermediate', 'advanced', 'expert'].includes(level)) {
    this.proficiency = level;
    return await this.save();
  } else {
    throw new Error('Invalid proficiency level');
  }
};

const Skill = mongoose.model('Skill', skillSchema);

export default Skill;
