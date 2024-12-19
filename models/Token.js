import mongoose from 'mongoose';

const tokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['access', 'refresh'],
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // Ensure automatic deletion upon expiry
  },
}, {
  timestamps: true
});

const Token = mongoose.model('Token', tokenSchema);

export default Token;