import mongoose from "mongoose";
import dotenv from "dotenv";
import { logger } from "../utils/logger.js";

dotenv.config();

let retryCount = 0;
const MAX_RETRIES = 5;

export const connectDB = async () => {
  if (retryCount >= MAX_RETRIES) {
    logger.error(
      `❌ MongoDB connection failed after ${MAX_RETRIES} attempts. Exiting process.`
    );
    process.exit(1);
  }

  logger.info(
    `🔄 Attempting to connect to MongoDB (Attempt ${retryCount + 1}/${MAX_RETRIES})...`
  );

  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      autoIndex: process.env.NODE_ENV !== "production",
      serverSelectionTimeoutMS: 10000, // Increased to 10s for better error logs
      socketTimeoutMS: 45000,
      family: 4,
    });

    retryCount = 0; // Reset retry count on successful connection
    logger.info(
      `✅ MongoDB connected successfully to: ${conn.connection.host}`
    );
    return conn;
  } catch (error) {
    retryCount++;
    const errorMessage = `❌ MongoDB Connection Error (Attempt ${retryCount}/${MAX_RETRIES}):
    - Error Type: ${error.name}
    - Message: ${error.message}
    - Database URI: ${process.env.MONGODB_URI?.replace(/\/\/[^:]+:[^@]+@/, "//****:****@")}
    - Server Response: ${error.reason || "No response details"}`;

    logger.error(errorMessage);

    if (retryCount < MAX_RETRIES) {
      logger.warn(`Retrying to connect to MongoDB in 5 seconds...`);
      setTimeout(() => connectDB(), 5000); // Retry after 5 seconds
    } else {
      logger.error(`❌ Maximum retry attempts reached. Exiting process.`);
      process.exit(1);
    }
  }
};

mongoose.connection.on("connected", () => {
  logger.info(`✅ MongoDB connection established`);
});

mongoose.connection.on("error", (err) => {
  logger.error(`❌ MongoDB Runtime Error:
  - Error Type: ${err.name}
  - Message: ${err.message}
  - Code: ${err.code || "No error code"}
  - Time: ${new Date().toISOString()}`);
});

mongoose.connection.on("disconnected", () => {
  logger.warn(`⚠️ MongoDB disconnected at ${new Date().toISOString()}`);
});
