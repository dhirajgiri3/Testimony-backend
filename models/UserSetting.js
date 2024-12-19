
import mongoose from 'mongoose';

const userSettingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  language: {
    type: String,
    default: 'en'
  },
  timezone: {
    type: String,
    default: 'UTC'
  },
  dateFormat: {
    type: String,
    enum: ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'],
    default: 'YYYY-MM-DD'
  },
  timeFormat: {
    type: String,
    enum: ['12h', '24h'],
    default: '24h'
  },
  currency: {
    type: String,
    default: 'USD'
  }
}, {
  timestamps: true
});

export default mongoose.model('UserSetting', userSettingSchema);