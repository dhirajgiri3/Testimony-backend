// src/controllers/goalsController.js

import asyncHandler from 'express-async-handler';
import Goal from '../models/Goal.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';

/**
 * Create a new goal
 */
export const createGoal = asyncHandler(async (req, res, next) => {
  const { title, description, targetDate, category } = req.body;

  // Validate required fields
  if (!title || !description || !targetDate || !category) {
    throw new AppError('All fields are required to create a goal', 400);
  }

  try {
    const goal = await Goal.create({
      user: req.user.id,
      title,
      description,
      targetDate: new Date(targetDate),
      category,
    });

    // Log goal creation activity
    await logUserActivity(req.user.id, 'CREATE_GOAL', { goalId: goal.id });

    res.status(201).json({
      success: true,
      data: goal,
      message: 'Goal created successfully',
    });
  } catch (error) {
    logger.error('❌ Error creating goal:', { error: error.message });
    throw new AppError('Failed to create goal', 500);
  }
});

/**
 * Get all goals for a seeker with pagination, filtering, and sorting
 */
export const getGoals = asyncHandler(async (req, res, next) => {
  const { seekerId } = req.params;

  if (!seekerId) {
    throw new AppError('Seeker ID is required', 400);
  }

  try {
    const goals = await Goal.find({ user: seekerId })
      .sort({ targetDate: 1 })
      .lean();

    res.status(200).json({
      success: true,
      count: goals.length,
      data: goals,
    });
  } catch (error) {
    logger.error('❌ Error fetching goals:', { error: error.message });
    throw new AppError('Failed to fetch goals', 500);
  }
});

/**
 * Update a specific goal
 */
export const updateGoal = asyncHandler(async (req, res, next) => {
  const { goalId } = req.params;
  const updates = req.body;

  if (!goalId) {
    throw new AppError('Goal ID is required', 400);
  }

  try {
    let goal = await Goal.findById(goalId);

    if (!goal) {
      throw new AppError('Goal not found', 404);
    }

    // Ensure the user owns the goal
    if (goal.user.toString() !== req.user.id) {
      throw new AppError('Not authorized to update this goal', 403);
    }

    goal = await Goal.findByIdAndUpdate(goalId, updates, {
      new: true,
      runValidators: true,
    });

    // Log goal update activity
    await logUserActivity(req.user.id, 'UPDATE_GOAL', { goalId: goal.id });

    res.status(200).json({
      success: true,
      data: goal,
      message: 'Goal updated successfully',
    });
  } catch (error) {
    logger.error('❌ Error updating goal:', { error: error.message });
    throw new AppError('Failed to update goal', 500);
  }
});

/**
 * Delete a specific goal
 */
export const deleteGoal = asyncHandler(async (req, res, next) => {
  const { goalId } = req.params;

  if (!goalId) {
    throw new AppError('Goal ID is required', 400);
  }

  try {
    const goal = await Goal.findById(goalId);

    if (!goal) {
      throw new AppError('Goal not found', 404);
    }

    // Ensure the user owns the goal
    if (goal.user.toString() !== req.user.id) {
      throw new AppError('Not authorized to delete this goal', 403);
    }

    await goal.remove();

    // Log goal deletion activity
    await logUserActivity(req.user.id, 'DELETE_GOAL', { goalId: goal.id });

    res.status(200).json({
      success: true,
      message: 'Goal deleted successfully',
    });
  } catch (error) {
    logger.error('❌ Error deleting goal:', { error: error.message });
    throw new AppError('Failed to delete goal', 500);
  }
});

/**
 * Helper function to log user activities
 * Ensure this function is imported or defined appropriately
 */
import { logUserActivity } from '../services/activityLogService.js';

export default {
  createGoal,
  getGoals,
  updateGoal,
  deleteGoal,
};
