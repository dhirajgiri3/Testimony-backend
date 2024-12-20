// src/models/BlacklistedToken.js

import mongoose from 'mongoose';
import crypto from 'crypto';

const BlacklistedTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
  },
  type: {
    type: String,
    enum: ['access', 'refresh'],
    required: true,
  },
  expireAt: {
    type: Date,
    required: true,
    index: { expires: '0' }, // TTL index will expire the document based on expireAt
  },
});

// Middleware to hash the token before saving
BlacklistedTokenSchema.pre('save', function(next) {
  if (this.isModified('token')) {
    this.token = crypto.createHash('sha256').update(this.token).digest('hex');
  }
  next();
});

const BlacklistedToken = mongoose.model('BlacklistedToken', BlacklistedTokenSchema);

export default BlacklistedToken;
