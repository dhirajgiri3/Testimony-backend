// app.js

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middlewares/errorHandler.js';
import apiRoutes from './routes/api/v1/index.js';
import { logger } from './utils/logger.js';
import csrfProtection from './middlewares/csrfProtection.js';
import applyCsrfProtection from './middlewares/csrf.js';

const app = express();

// Validate Environment Variables
import { validateEnvVars } from './utils/validation.js';
import passportConfig from './config/passport.js';
validateEnvVars();

// Passport Configuration
passportConfig(passport);
app.use(passport.initialize());

// Security Middlewares
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(cookieParser(process.env.COOKIE_SECRET));

// Logger Middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', { stream: logger.stream }));
}

// Body Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate Limiting
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api', generalLimiter);

// CSRF Protection
app.use(csrfProtection);

// Routes
app.use('/api/v1', applyCsrfProtection(apiRoutes));

// Error Handling Middleware
app.use(errorHandler);

export default app;
