import mongoose from 'mongoose';
import crypto from 'crypto';

const tokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['access', 'refresh'],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: '1d' }, // Ensure automatic deletion upon expiry
    },
  },
  {
    timestamps: true,
  }
);

// Middleware to hash the token before saving
tokenSchema.pre('save', function (next) {
  if (this.isModified('token')) {
    this.token = crypto.createHash('sha256').update(this.token).digest('hex');
  }
  next();
});

// Static method to invalidate tokens
tokenSchema.statics.invalidateTokens = async function (userId) {
  await this.deleteMany({ user: userId });
};

const Token = mongoose.model('Token', tokenSchema);

export default Token;
