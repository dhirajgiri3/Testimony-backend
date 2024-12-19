// src/routes/api/v1/healthcheck.js

import express from 'express';
import { healthcheck } from '../../../controllers/healthCheckController.js'; // Add .js extension

const router = express.Router();

/**
 * @route   GET /api/v1/healthcheck
 * @desc    Health check endpoint
 * @access  Public
 */
router.get('/', healthcheck);

export default router;