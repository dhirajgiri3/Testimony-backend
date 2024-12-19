// src/app.js

import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import xss from 'xss-clean';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import morgan from 'morgan';
import compression from 'compression';
import apiRoutes from './routes/api/v1/index.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { logger } from './utils/logger.js';
import AppError from './utils/appError.js';
import { v4 as uuidv4 } from 'uuid';
import './config/passport.js'; // Passport configuration
import session from 'express-session';
import { emailVerificationRateLimit, emailResendRateLimit, profileUpdateRateLimit, tokenRefreshRateLimit, loginAttemptRateLimit, otpRequestRateLimit, passwordResetRateLimit } from './middlewares/rateLimiter.js'; // Import rate limit middleware
import { requestLogger } from './middlewares/logger.js';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'MONGODB_URI',
  'PORT',
  'REDIS_HOST',
  'REDIS_PORT',
  'MAILTRAP_HOST',
  'MAILTRAP_PORT',
  'MAILTRAP_USER',
  'MAILTRAP_PASS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
];
requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    logger.error(`FATAL ERROR: ${envVar} is not defined.`);
    process.exit(1);
  }
});

// Initialize Express app
const app = express();

// Assign a unique request ID for every incoming request
app.use((req, res, next) => {
  req.id = uuidv4();
  next();
});

// Middleware Enhancements
app.use(helmet()); // Set security HTTP headers

// Content Security Policy (CSP) with better controls
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'trustedscripts.com'],
      connectSrc: ["'self'", process.env.CLIENT_URL],
      imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  })
);

// Enable HSTS (HTTP Strict Transport Security) for 1 year
app.use(
  helmet.hsts({
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
  })
);

// CORS Configuration
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// Request Logging
app.use(requestLogger);

// Parse incoming requests
app.use(express.json({ limit: '10kb' })); // Limit request body size
app.use(express.urlencoded({ extended: true, limit: '10kb' })); // Limit URL-encoded request body size
app.use(xss()); // Sanitize user input against XSS attacks
app.use(hpp()); // Prevent HTTP Parameter Pollution
app.use(cookieParser()); // Parse cookies
app.use(compression()); // Compress responses with Gzip & Brotli

// Rate Limiting for API requests
app.use('/api/v1/email/verify', emailVerificationRateLimit);
app.use('/api/v1/email/resend', emailResendRateLimit);
app.use('/api/v1/profile/update', profileUpdateRateLimit);
app.use('/api/v1/token/refresh', tokenRefreshRateLimit);
app.use('/api/v1/login', loginAttemptRateLimit);
app.use('/api/v1/otp/request', otpRequestRateLimit);
app.use('/api/v1/password/reset', passwordResetRateLimit);

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(
    morgan('combined', {
      stream: {
        write: (message) => logger.info(message.trim()),
      },
    })
  );
}

// Initialize Passport for authentication
app.use(
  session({
    secret: process.env.JWT_ACCESS_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Attach Request Logger
app.use((req, res, next) => {
  logger.info(
    `🔍 Request ID: ${req.id} | ${req.method} ${req.url} | IP: ${req.ip} | User-Agent: ${req.headers['user-agent']}`
  );
  next();
});

// API Routes
app.use('/api/v1', apiRoutes);

// 404 handler for undefined routes
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Error Handling Middleware
app.use(errorHandler);

export default app;