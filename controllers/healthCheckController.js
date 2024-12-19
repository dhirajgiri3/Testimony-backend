import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

/**
 * @desc    Health check endpoint to verify API and database status
 * @route   GET /api/v1/healthcheck
 * @access  Public
 */
export const healthcheck = async (req, res) => {
    try {
        // Check database connection
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

        // Basic system info
        const healthData = {
            status: 'healthy',
            timestamp: new Date(),
            service: 'Testimony API',
            database: {
                status: dbStatus,
                name: mongoose.connection.name
            },
            uptime: process.uptime(),
            memory: {
                usage: process.memoryUsage().heapUsed,
                total: process.memoryUsage().heapTotal
            }
        };

        // If database is not connected, mark status as degraded
        if (dbStatus !== 'connected') {
            healthData.status = 'degraded';
        }

        logger.info('Health check performed successfully');
        res.status(200).json(healthData);

    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(500).json({
            status: 'unhealthy',
            timestamp: new Date(),
            error: 'Internal server error during health check'
        });
    }
};