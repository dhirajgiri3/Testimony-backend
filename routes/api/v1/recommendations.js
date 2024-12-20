import express from 'express';
import { generateRecommendations } from '../../../services/recommendationService.js';
import { protect } from '../../../middlewares/auth.js';
import { authorize } from '../../../middlewares/role.js';

const router = express.Router();

/**
 * @route   POST /api/v1/recommendations/generate/:seekerId
 * @desc    Generate personalized recommendations for a seeker
 * @access  Protected
 */
router.post(
  '/generate/:seekerId',
  protect,
  authorize('seeker'),
  async (req, res, next) => {
    try {
      const recommendations = await generateRecommendations(
        req.params.seekerId
      );
      res.status(200).json({
        success: true,
        data: recommendations,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
