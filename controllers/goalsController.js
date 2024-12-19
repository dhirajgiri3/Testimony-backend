import asyncHandler from "express-async-handler";
import Goal from "../models/Goal.js";
import { logger } from "../utils/logger.js";
import AppError from "../utils/appError.js";

/**
 * Create a new goal
 */
export const createGoal = async (req, res, next) => {
  try {
    const goal = await Goal.create({
      user: req.user.id,
      ...req.body,
    });

    res.status(201).json({
      success: true,
      data: goal,
    });
  } catch (error) {
    logger.error("❌ Error creating goal:", error);
    next(error);
  }
};

/**
 * Get all goals for a seeker
 */
export const getGoals = async (req, res, next) => {
  try {
    const goals = await Goal.find({ user: req.params.seekerId });

    res.status(200).json({
      success: true,
      count: goals.length,
      data: goals,
    });
  } catch (error) {
    logger.error("❌ Error fetching goals:", error);
    next(error);
  }
};

/**
 * Update a specific goal
 */
export const updateGoal = asyncHandler(async (req, res, next) => {
  let goal = await Goal.findById(req.params.goalId);

  if (!goal) {
    return next(new AppError("Goal not found", 404));
  }

  // Ensure the user owns the goal
  if (goal.user.toString() !== req.user.id) {
    return next(new AppError("Not authorized to update this goal", 403));
  }

  goal = await Goal.findByIdAndUpdate(req.params.goalId, req.body, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    data: goal,
  });
});

/**
 * Delete a specific goal
 */
export const deleteGoal = asyncHandler(async (req, res, next) => {
  const goal = await Goal.findById(req.params.goalId);

  if (!goal) {
    return next(new AppError("Goal not found", 404));
  }

  // Ensure the user owns the goal
  if (goal.user.toString() !== req.user.id) {
    return next(new AppError("Not authorized to delete this goal", 403));
  }

  await goal.remove();

  res.status(200).json({
    success: true,
    message: "Goal deleted successfully",
  });
});
