// src/config/db.js

import mongoose from "mongoose";
import dotenv from "dotenv";
import { logger } from "../utils/logger.js";

dotenv.config();

export const connectDB = async () => {
  logger.info("🔄 Attempting to connect to MongoDB...");
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    logger.info("✅ MongoDB connection successful");
    return conn;
  } catch (error) {
    logger.error(`❌ MongoDB Connection Error: ${error.message}`);
    throw error;
  }
};