// src/sockets/notificationSocket.js

import { Server } from 'socket.io';
import { redisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { verifyAuthToken } from '../utils/auth.js';
import dotenv from 'dotenv';

dotenv.config();

let io;

/**
 * Initializes Socket.IO server for real-time notifications.
 *
 * @param {http.Server} server - The HTTP server instance.
 * @returns {SocketIO.Server} - The initialized Socket.IO server.
 */
export const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      // Verify token and extract user ID
      const userId = await verifyAuthToken(token);
      if (!userId) {
        return next(new Error('Authentication error: Invalid token'));
      }

      socket.userId = userId;
      next();
    } catch (error) {
      logger.error('❌ Socket.IO Authentication Error:', error);
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`🔌 User connected: ${socket.userId}`);

    socket.on('disconnect', () => {
      logger.info(`🔌 User disconnected: ${socket.userId}`);
    });
  });

  handleSocketConnections(io);

  return io;
};

/**
 * Sends a real-time notification to the user via Socket.IO.
 *
 * @param {string} userId - The user's ID.
 * @param {Object} notification - The notification object.
 */
export const sendRealTimeNotification = async (userId, notification) => {
  try {
    const socketIds = await redisClient.sMembers(`userSockets:${userId}`);
    socketIds.forEach((socketId) => {
      io.to(socketId).emit('newNotification', notification);
    });
  } catch (error) {
    logger.error(`❌ Failed to retrieve socket IDs for User ${userId}:`, error);
  }
};

/**
 * Handles user socket connections and disconnections.
 *
 * @param {SocketIO.Server} io - The Socket.IO server instance.
 */
export const handleSocketConnections = (io) => {
  io.on('connection', (socket) => {
    const userId = socket.userId;

    if (userId) {
      // Add socket ID to the user's set of sockets
      redisClient.sAdd(`userSockets:${userId}`, socket.id).catch((error) => {
        logger.error(`❌ Failed to add socket ID for User ${userId}:`, error);
      });

      socket.on('disconnect', () => {
        // Remove socket ID from the user's set of sockets
        redisClient.sRem(`userSockets:${userId}`, socket.id).catch((error) => {
          logger.error(
            `❌ Failed to remove socket ID for User ${userId}:`,
            error
          );
        });
      });
    }
  });
};
