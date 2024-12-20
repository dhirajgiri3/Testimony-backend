// src/controllers/skillsController.js

import asyncHandler from 'express-async-handler';
import Skill from '../models/Skill.js';
import Analytics from '../models/Analytics.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
import { logUserActivity } from '../services/activityLogService.js';
import skillService from '../services/skillService.js';

/**
 * Get all skills for the current user with pagination and filtering
 * @route GET /api/v1/skills
 * @access Private (Seeker)
 */
export const getSkills = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, category } = req.query;

  const filters = { seeker: req.user.id };

  if (category) {
    filters.category = category;
  }

  try {
    const skills = await Skill.find(filters)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit, 10))
      .lean();

    const total = await Skill.countDocuments(filters);

    res.status(200).json({
      success: true,
      count: skills.length,
      total,
      page: parseInt(page, 10),
      pages: Math.ceil(total / limit),
      data: skills,
    });
  } catch (error) {
    logger.error('❌ Error fetching skills:', { error: error.message });
    throw new AppError('Failed to fetch skills', 500);
  }
});

/**
 * Add a new skill
 * @route POST /api/v1/skills
 * @access Private (Seeker)
 */
export const addSkill = asyncHandler(async (req, res, next) => {
  const { name, category } = req.body;

  // Validate required fields
  if (!name || !category) {
    throw new AppError('Skill name and category are required', 400);
  }

  try {
    const existingSkill = await Skill.findOne({
      seeker: req.user.id,
      name: name.trim(),
    });
    if (existingSkill) {
      throw new AppError('Skill already exists', 400);
    }

    const newSkill = await Skill.create({
      seeker: req.user.id,
      name: name.trim(),
      category: category.trim(),
    });

    // Log skill addition activity
    await logUserActivity(req.user.id, 'ADD_SKILL', { skillId: newSkill.id });

    res.status(201).json({
      success: true,
      data: newSkill,
      message: 'Skill added successfully',
    });
  } catch (error) {
    logger.error('❌ Error adding skill:', { error: error.message });
    throw new AppError('Failed to add skill', 500);
  }
});

/**
 * Update a skill
 * @route PUT /api/v1/skills/:id
 * @access Private (Seeker)
 */
export const updateSkill = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, category } = req.body;

  // Validate required fields
  if (!name && !category) {
    throw new AppError(
      'At least one field (name or category) is required to update',
      400
    );
  }

  try {
    let skill = await Skill.findOne({ _id: id, seeker: req.user.id });

    if (!skill) {
      throw new AppError('Skill not found', 404);
    }

    // Update fields if provided
    if (name) skill.name = name.trim();
    if (category) skill.category = category.trim();

    await skill.save();

    // Log skill update activity
    await logUserActivity(req.user.id, 'UPDATE_SKILL', { skillId: skill.id });

    res.status(200).json({
      success: true,
      data: skill,
      message: 'Skill updated successfully',
    });
  } catch (error) {
    logger.error('❌ Error updating skill:', { error: error.message });
    throw new AppError('Failed to update skill', 500);
  }
});

/**
 * Delete a skill
 * @route DELETE /api/v1/skills/:id
 * @access Private (Seeker)
 */
export const deleteSkill = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  try {
    const skill = await Skill.findOneAndDelete({
      _id: id,
      seeker: req.user.id,
    });

    if (!skill) {
      throw new AppError('Skill not found', 404);
    }

    // Log skill deletion activity
    await logUserActivity(req.user.id, 'DELETE_SKILL', { skillId: id });

    res.status(204).json({
      success: true,
      data: null,
      message: 'Skill deleted successfully',
    });
  } catch (error) {
    logger.error('❌ Error deleting skill:', { error: error.message });
    throw new AppError('Failed to delete skill', 500);
  }
});

/**
 * Get Advanced Skill Insights
 * @route GET /api/v1/skills/insights
 * @access Private (Seeker)
 */
export const getSkillInsights = asyncHandler(async (req, res, next) => {
  const { timeframe = '6months', category } = req.query;

  if (!req.user?.id) {
    throw new AppError('User authentication required', 401);
  }

  try {
    // Fetch user analytics
    const analytics = await Analytics.findOne({ seeker: req.user.id }).lean();
    if (!analytics) {
      throw new AppError('No analytics data available', 404);
    }

    // Define time range based on timeframe
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(
      endDate.getMonth() - (timeframe === '12months' ? 12 : 6)
    );

    // Fetch relevant testimonials
    const testimonials = await Testimonial.find({
      seeker: req.user.id,
      createdAt: { $gte: startDate, $lte: endDate },
    })
      .select('skills status feedback createdAt')
      .lean();

    // Generate skill insights using skillService
    const skillAnalytics = await skillService.processSkillData(
      testimonials,
      category
    );

    // Update analytics with new skill insights
    await Analytics.findOneAndUpdate(
      { seeker: req.user.id },
      { skills: skillAnalytics },
      { new: true }
    );

    // Log skill insights generation activity
    await logUserActivity(req.user.id, 'GENERATE_SKILL_INSIGHTS');

    res.status(200).json({
      success: true,
      data: skillAnalytics,
    });
  } catch (error) {
    logger.error('Error in skill insights:', { error: error.message });
    throw new AppError('Failed to process skill insights', 500);
  }
});

export default {
  getSkills,
  addSkill,
  updateSkill,
  deleteSkill,
  getSkillInsights,
};
