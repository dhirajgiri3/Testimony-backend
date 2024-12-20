// src/routes/api/v1/recommendations.js

import express from 'express';
import { getRecommendations } from '../../../controllers/recommendationController.js';
import { protect } from '../../../middlewares/auth.js';
import { authorize } from '../../../middlewares/role.js';

const router = express.Router();

// Get Recommendations
router.get('/', protect, authorize('seeker'), getRecommendations);

export default router;
