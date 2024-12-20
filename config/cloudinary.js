// cloudinary.js

import { v2 as cloudinary } from 'cloudinary';
import { logger } from '../utils/logger.js';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Test Cloudinary Connection
const testCloudinaryConnection = async () => {
  try {
    const result = await cloudinary.api.resources({ max_results: 1 });
    if (result.total_count >= 0) {
      logger.info('✅ Connected to Cloudinary successfully.');
    }
  } catch (error) {
    logger.error('❌ Cloudinary connection error:', error);
    throw new Error('Cloudinary configuration failed.');
  }
};

export { cloudinary, testCloudinaryConnection };
