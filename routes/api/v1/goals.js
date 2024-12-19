import express from "express";

import {
  createGoal,
  getGoals,
  updateGoal,
  deleteGoal,
} from "../../../controllers/goalsController.js";
import { protect } from "../../../middlewares/auth.js";

const router = express.Router();

/**
 * @route   POST /api/v1/goals
 * @desc    Create a new goal
 * @access  Protected
 */
router.post("/", protect, createGoal);

/**
 * @route   GET /api/v1/goals/seeker/:seekerId
 * @desc    Get all goals for a seeker
 * @access  Protected
 */
router.get("/seeker/:seekerId", protect, getGoals);

/**
 * @route   PUT /api/v1/goals/:goalId
 * @desc    Update a specific goal
 * @access  Protected
 */
router.put("/:goalId", protect, updateGoal);

/**
 * @route   DELETE /api/v1/goals/:goalId
 * @desc    Delete a specific goal
 * @access  Protected
 */
router.delete("/:goalId", protect, deleteGoal);

// ...existing code...

export default router;
