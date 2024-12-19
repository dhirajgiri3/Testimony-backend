// src/models/BlacklistedToken.js

import mongoose from 'mongoose';

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

const BlacklistedToken = mongoose.model('BlacklistedToken', BlacklistedTokenSchema);

export default BlacklistedToken;