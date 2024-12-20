// src/routes/api/v1/skills.js

import express from 'express';
import { protect } from '../../../middlewares/auth.js';
import { authorize } from '../../../middlewares/role.js';
import {
  getSkills,
  addSkill,
  updateSkill,
  deleteSkill,
  getSkillInsights,
} from '../../../controllers/skillsController.js';

const router = express.Router();

// Get Skill Insights
router.get('/insights', protect, authorize('seeker'), getSkillInsights);

/**
 * @route   GET /api/v1/skills/seeker/:seekerId
 * @desc    Get all skills for a seeker
 * @access  Protected
 */
router.get('/seeker/:seekerId', protect, getSkills);

/**
 * @route   POST /api/v1/skills/seeker/:seekerId
 * @desc    Add a new skill for a seeker
 * @access  Protected
 */
router.post('/seeker/:seekerId', protect, addSkill);

/**
 * @route   PUT /api/v1/skills/:skillId
 * @desc    Update a specific skill
 * @access  Protected
 */
router.put('/:skillId', protect, updateSkill);

/**
 * @route   DELETE /api/v1/skills/:skillId
 * @desc    Delete a specific skill
 * @access  Protected
 */
router.delete('/:skillId', protect, deleteSkill);

export default router;
