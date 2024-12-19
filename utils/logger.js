// /backend/utils/logger.js

import winston from "winston";
import "winston-daily-rotate-file";

const { combine, timestamp, printf, colorize, metadata } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, metadata }) => {
  const { requestId, ...meta } = metadata;
  const metaString = Object.keys(meta).length ? JSON.stringify(meta) : "";
  return `${timestamp} [${level}] [RequestID: ${requestId || "N/A"}]: ${message} ${metaString}`;
});

// Create Winston logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    metadata({ fillExcept: ["message", "level", "timestamp"] }),
    colorize(),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.DailyRotateFile({
      dirname: "logs",
      filename: "application-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d",
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: "logs/exceptions.log" }),
  ],
  exitOnError: false,
});