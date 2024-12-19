import express from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import cors from 'cors';
import { nanoid } from 'nanoid';

// Route Imports
import authRoutes from "./auth.js";
import userRoutes from "./users.js";
import testimonialRoutes from "./testimonials.js";
import analyticsRoutes from "./analytics.js";
import aiRoutes from "./ai.js";
import goalsRoutes from "./goals.js";
import skillsRoutes from "./skills.js";
import predictiveRoutes from "./predictive.js";
import recommendationsRoutes from "./recommendations.js";
import healthcheckRoutes from "./healthcheck.js";

import { logger } from "../../../utils/logger.js";
import AppError from "../../../utils/appError.js";
import { handleNotFound } from "../../../middlewares/errorHandler.js";

const router = express.Router();

// Security Middleware
router.use(helmet());
router.use(mongoSanitize());
router.use(hpp());
router.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(apiLimiter);

// Request Tracking Middleware
router.use((req, res, next) => {
  req.requestId = nanoid();
  req.startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    logger.info('API Request', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      userAgent: req.headers['user-agent'],
      ip: req.ip
    });
  });
  
  next();
});

// Swagger Configuration
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Testimony API Documentation",
      version: "1.0.0",
      description: "API documentation for Testimony application",
      contact: {
        name: "API Support",
        email: "support@testimony.com",
      },
    },
    servers: [
      {
        url: process.env.API_URL || "http://localhost:5003",
        description: "API Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      responses: {
        UnauthorizedError: {
          description: "Authentication is required",
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    example: 'Unauthorized access'
                  }
                }
              }
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ["./routes/api/v1/*.js", "./models/*.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// API Documentation Routes
router.use("/docs", swaggerUi.serve);
router.get("/docs", swaggerUi.setup(swaggerSpec));
router.get("/docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// API Version and Health Check
router.get("/version", (req, res) => {
  res.json({
    version: process.env.API_VERSION || "1.0.0",
    apiVersion: "v1",
    status: "stable",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
const apiRoutes = [
  { path: "/auth", router: authRoutes },
  { path: "/users", router: userRoutes },
  { path: "/testimonials", router: testimonialRoutes },
  { path: "/analytics", router: analyticsRoutes },
  { path: "/ai", router: aiRoutes },
  { path: "/goals", router: goalsRoutes },
  { path: "/skills", router: skillsRoutes },
  { path: "/predictive", router: predictiveRoutes },
  { path: "/recommendations", router: recommendationsRoutes },
  { path: "/healthcheck", router: healthcheckRoutes }
];

// Register routes
apiRoutes.forEach(({ path, router: routeHandler }) => {
  router.use(path, routeHandler);
});

// 404 Handler
router.use(handleNotFound);

// Global Error Handler
router.use((err, req, res, next) => {
  const errorResponse = {
    success: false,
    message: err.message || 'Internal server error',
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  };

  // Handle specific error types
  if (err instanceof ValidationError) {
    errorResponse.status = 400;
    errorResponse.errors = err.array().map(({ param, msg }) => ({
      field: param,
      message: msg
    }));
  } else if (err instanceof AppError) {
    errorResponse.status = err.statusCode;
    if (err.errors) {
      errorResponse.errors = err.errors;
    }
  } else {
    errorResponse.status = err.status || 500;
    
    // Log internal server errors
    if (errorResponse.status === 500) {
      logger.error('Unhandled Error:', {
        requestId: req.requestId,
        error: err.message,
        stack: err.stack,
        method: req.method,
        path: req.originalUrl,
        body: req.body,
        user: req.user?.id
      });

      // Don't send stack trace in production
      if (process.env.NODE_ENV === 'production') {
        errorResponse.message = 'Internal server error';
      }
    }
  }

  res.status(errorResponse.status).json(errorResponse);
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Performing graceful shutdown...');
  // Add cleanup logic here if needed
  process.exit(0);
});

export default router;
