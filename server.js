// src/server.js

import { createServer } from "http";
import { app, validateEnvVars } from "./app.js";
import { connectDB } from "./config/db.js";
import { redis } from "./config/redis.js";
import { logger } from "./utils/logger.js";
import "./jobs/worker.js";
import { testOpenAIConnection } from "./config/openAI.js";
import mongoose from "mongoose";

// Suppress specific Redis warnings
const originalWarn = console.warn;
console.warn = function (...args) {
  if (
    args.some(
      (arg) => typeof arg === "string" && arg.includes("Eviction policy")
    )
  ) {
    return;
  }
  originalWarn.apply(console, args);
};

const server = createServer(app);

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  const shutdownTimeout = setTimeout(() => {
    logger.error("Forced shutdown due to timeout");
    process.exit(1);
  }, 30000);

  try {
    server.close(() => logger.info("HTTP server closed"));
    await redis.quit();
    await mongoose.connection.close();
    await testOpenAIConnection(false); // Assuming a method to close OpenAI connections

    clearTimeout(shutdownTimeout);
    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
};

// Process handlers
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("Unhandled Rejection");
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  gracefulShutdown("Uncaught Exception");
});

["SIGTERM", "SIGINT"].forEach((signal) => {
  process.on(signal, () => gracefulShutdown(signal));
});

// Start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    validateEnvVars();
    await connectDB();
    await testOpenAIConnection(true); // Assuming a method to test OpenAI connections

    server.listen(PORT, () => {
      logger.info(
        `✅ Server running in ${process.env.NODE_ENV} mode on port ${PORT}`
      );
    });
  } catch (error) {
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
