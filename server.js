// server.js

import { createServer } from 'http';
import app from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { redisClient } from './config/redis.js';
import { logger } from './utils/logger.js';
import { testOpenAIConnection } from './config/openAI.js';
import {  shutdownWorkers } from './jobs/worker.js'; // Import workerInstances and shutdownWorkers
import { initializeSocket, handleSocketConnections } from './sockets/notificationSocket.js'; // Import initializeSocket

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    logger.info('✅ Connected to MongoDB');

    // Connect to Redis
    await redisClient.connect();
    logger.info('✅ Connected to Redis');

    // Test OpenAI Connection
    await testOpenAIConnection();

    // Create HTTP Server
    const PORT = process.env.PORT || 5003;
    const server = createServer(app);

    // Initialize Socket.IO
    const io = initializeSocket(server);

    // Handle Socket.IO connections
    handleSocketConnections(io);
    logger.info('✅ Socket.IO initialized');

    server.listen(PORT, () => {
      logger.info(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    });

    // Graceful Shutdown
    const shutdownSignals = ['SIGINT', 'SIGTERM'];

    shutdownSignals.forEach((signal) => {
      process.on(signal, async () => {
        try {
          logger.info(`${signal} received. Starting graceful shutdown...`);

          // Stop accepting new connections
          server.close(async (err) => {
            if (err) {
              logger.error('❌ Error during server close:', err);
              process.exit(1);
            }

            // Disconnect from MongoDB
            await disconnectDB();
            logger.info('✅ MongoDB connection closed.');

            // Disconnect from Redis
            await redisClient.quit();
            logger.info('✅ Redis connection closed.');

            // Shutdown BullMQ workers
            await shutdownWorkers();
            logger.info('✅ BullMQ workers shut down.');

            logger.info('🔒 Graceful shutdown complete.');
            process.exit(0);
          });
        } catch (error) {
          logger.error('❌ Error during graceful shutdown:', error);
          process.exit(1);
        }
      });
    });
  } catch (error) {
    logger.error('❌ Error starting server:', error);
    process.exit(1);
  }
};

startServer();
