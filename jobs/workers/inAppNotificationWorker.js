// src/jobs/workers/inAppNotificationWorker.js

import { Worker } from 'bullmq';
import { logger } from '../../utils/logger.js';
import Notification from '../../models/Notification.js';
import AppError from '../../utils/appError.js';
import { sendRealTimeNotification } from '../../sockets/notificationSocket.js'; // Socket.IO integration
import { redisClient } from '../../config/redis.js'; // Ensure redisClient is imported

// Define the Notification Worker
const inAppNotificationWorker = new Worker(
    'notificationQueue',
    async (job) => {
        const { userId, message, options } = job.data;

        try {
            // Validate input
            if (!userId || !message) {
                throw new AppError('User ID and message are required', 400);
            }

            // Create a new in-app notification
            const notification = await Notification.create({
                user: userId,
                message,
                read: false,
                ...options,
            });

            logger.info(
                `📩 In-app notification created for User ${userId}: ${message}`
            );

            // Send real-time notification via WebSockets
            await sendRealTimeNotification(userId, notification);
        } catch (error) {
            logger.error(
                `❌ Failed to create in-app notification for User ${userId}:`,
                error
            );
            throw new AppError('Failed to create in-app notification', 500);
        }
    },
    { connection: redisClient, concurrency: 20 }
);

// Event Listeners
inAppNotificationWorker.on('completed', (job) => {
    logger.info(`✅ Notification job ${job.id} completed successfully.`);
});

inAppNotificationWorker.on('failed', (job, err) => {
    logger.error(`❌ Notification job ${job.id} failed: ${err.message}`);
});

inAppNotificationWorker.on('error', (err) => {
    logger.error('❌ In-App Notification Worker encountered an error:', err);
});

export default inAppNotificationWorker;
