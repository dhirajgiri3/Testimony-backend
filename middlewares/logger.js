// src/middlewares/logger.js

import { logger } from '../utils/logger.js';

export const requestLogger = (req, res, next) => {
  logger.info({
    event: 'request_received',
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  next();
};