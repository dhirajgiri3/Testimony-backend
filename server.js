// /backend/server.js

// Suppress "Eviction policy" warnings
const originalWarn = console.warn;
console.warn = function (...args) {
  if (
    args.some(
      (arg) => typeof arg === "string" && arg.includes("Eviction policy")
    )
  ) {
    return; // Suppress only this warning
  }
  originalWarn.apply(console, args);
};

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import hpp from "hpp";
import xss from "xss-clean";
import cookieParser from "cookie-parser";
import passport from "passport";
import morgan from "morgan";
import { connectDB } from "./config/db.js";
import apiRoutes from "./routes/api/v1/index.js";
import { logger } from "./utils/logger.js";
import "./jobs/worker.js";

dotenv.config();

// Initialize Express app
const app = express();

// Connect to Database
connectDB()
  .then(() => {
    logger.info("✅ Connected to MongoDB");
  })
  .catch((error) => {
    logger.error("❌ Database connection error:", error);
    process.exit(1); // Exit if DB connection fails
  });

// Middleware
app.use(helmet()); // Set security HTTP headers
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(xss()); // Sanitize user input
app.use(hpp()); // Prevent HTTP Parameter Pollution
app.use(cookieParser()); // Parse cookies

// Logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(
    morgan("combined", {
      stream: {
        write: (message) => logger.info(message.trim()),
      },
    })
  );
}

// CSRF Protection for mutation requests
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    csrfProtection(req, res, next);
  } else {
    next();
  }
});

// Initialize Passport
app.use(passport.initialize());

// Routes
app.use(
  "/api/v1",
  (req, res, next) => {
    logger.info(`Incoming request: ${req.method} ${req.url}`, {
      headers: req.headers,
      body: req.body,
      query: req.query,
    });
    next();
  },
  apiRoutes
);

// Error handling for CSRF
app.use((err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') return next(err);


  // Handle CSRF token errors here
  res.status(403).json({
    success: false,
    message: 'Form tampered with',
  });
});

// Error Handler Middleware
app.use((err, _req, res, _next) => {
  logger.error("Unhandled error:", {
    message: err.message,
    stack: err.stack,
    status: err.status || 500,
  });
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server Error',
  });
});
