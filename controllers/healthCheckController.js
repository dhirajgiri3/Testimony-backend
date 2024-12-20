// src/controllers/healthCheckController.js

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

/**
 * Health check endpoint to verify API and database status
 * @route GET /api/v1/healthcheck
 * @access Public
 */
export const healthcheck = asyncHandler(async (req, res, next) => {
  try {
    // Check database connection
    const dbStatus =
      mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

    // Basic system info
    const healthData = {
      status: 'healthy',
      timestamp: new Date(),
      service: 'Testimony API',
      database: {
        status: dbStatus,
        name: mongoose.connection.name,
      },
      uptime: process.uptime(),
      memory: {
        usage: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
      },
    };

    // If database is not connected, mark status as degraded
    if (dbStatus !== 'connected') {
      healthData.status = 'degraded';
    }

    logger.info('Health check performed successfully');
    res.status(200).json(healthData);
  } catch (error) {
    logger.error('Health check failed:', { error: error.message });
    throw new AppError('Internal server error during health check', 500);
  }
});

export default {
  healthcheck,
};
