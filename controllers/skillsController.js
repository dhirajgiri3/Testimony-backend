// src/controllers/skillController.js

import asyncHandler from "express-async-handler";
import Analytics from "../models/Analytics.js";
import Testimonial from "../models/Testimonial.js";
import Skill from "../models/Skills.js";
import AppError from "../utils/appError.js";
import { logger } from "../utils/logger.js";

/**
 * @desc    Get all skills
 * @route   GET /api/v1/skills
 * @access  Private (Seeker)
 */
const getSkills = asyncHandler(async (req, res, next) => {
    const skills = await Skill.find({ seeker: req.user.id }).lean();
    res.status(200).json({
        success: true,
        data: skills
    });
});

/**
 * @desc    Add a new skill
 * @route   POST /api/v1/skills
 * @access  Private (Seeker)
 */
const addSkill = asyncHandler(async (req, res, next) => {
    const { name, category } = req.body;

    if (!name || !category) {
        throw new AppError("Skill name and category are required", 400);
    }

    const newSkill = await Skill.create({
        seeker: req.user.id,
        name,
        category
    });

    res.status(201).json({
        success: true,
        data: newSkill
    });
});

/**
 * @desc    Update a skill
 * @route   PUT /api/v1/skills/:id
 * @access  Private (Seeker)
 */
const updateSkill = asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const { name, category } = req.body;

    const updatedSkill = await Skill.findOneAndUpdate(
        { _id: id, seeker: req.user.id },
        { name, category },
        { new: true, runValidators: true }
    );

    if (!updatedSkill) {
        throw new AppError("Skill not found", 404);
    }

    res.status(200).json({
        success: true,
        data: updatedSkill
    });
});

/**
 * @desc    Delete a skill
 * @route   DELETE /api/v1/skills/:id
 * @access  Private (Seeker)
 */
const deleteSkill = asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    const deletedSkill = await Skill.findOneAndDelete({ _id: id, seeker: req.user.id });

    if (!deletedSkill) {
        throw new AppError("Skill not found", 404);
    }

    res.status(204).json({
        success: true,
        data: null
    });
});

/**
 * @desc    Get Advanced Skill Insights
 * @route   GET /api/v1/skills/insights
 * @access  Private (Seeker)
 */
const getSkillInsights = asyncHandler(async (req, res, next) => {
    const { timeframe = '6months', category } = req.query;

    // Input validation
    if (!req.user?.id) {
        throw new AppError("User authentication required", 401);
    }

    try {
        // Get base analytics
        const analytics = await Analytics.findOne({ seeker: req.user.id }).lean();
        if (!analytics) {
            throw new AppError("No analytics data available", 404);
        }

        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(endDate.getMonth() - (timeframe === '12months' ? 12 : 6));

        // Get testimonials for skill analysis
        const testimonials = await Testimonial.find({
            seeker: req.user.id,
            createdAt: { $gte: startDate, $lte: endDate }
        }).select('skills status feedback createdAt').lean();

        // Process skill data
        const skillAnalytics = processSkillData(testimonials, category);

        // Combine with existing analytics
        const enhancedSkillData = {
            ...analytics.skills,
            ...skillAnalytics,
            lastUpdated: new Date(),
        };

        // Store updated analytics
        await Analytics.findOneAndUpdate(
            { seeker: req.user.id },
            { $set: { skills: enhancedSkillData } },
            { new: true }
        );

        res.status(200).json({
            success: true,
            data: enhancedSkillData
        });

    } catch (error) {
        logger.error("Error in skill insights:", error);
        throw new AppError("Failed to process skill insights", 500);
    }
});

/**
 * Helper function to process skill data
 */
function processSkillData(testimonials, category) {
    const skillStats = {};
    const skillTrends = {};
    const topSkills = {};
    const skillGrowth = {};

    testimonials.forEach(testimonial => {
        testimonial.skills?.forEach(skill => {
            if (category && skill.category !== category) return;

            // Basic stats
            if (!skillStats[skill.name]) {
                skillStats[skill.name] = {
                    count: 0,
                    positiveEndorsements: 0,
                    category: skill.category
                };
            }
            skillStats[skill.name].count++;

            // Track monthly trends
            const month = testimonial.createdAt.toISOString().slice(0, 7);
            if (!skillTrends[month]) skillTrends[month] = {};
            skillTrends[month][skill.name] = (skillTrends[month][skill.name] || 0) + 1;

            // Calculate positive endorsements
            if (testimonial.feedback?.sentiment === 'positive') {
                skillStats[skill.name].positiveEndorsements++;
            }
        });
    });

    // Calculate growth rates and top skills
    Object.entries(skillStats).forEach(([skill, stats]) => {
        const growthRate = calculateGrowthRate(skillTrends, skill);
        skillGrowth[skill] = growthRate;

        topSkills[skill] = {
            endorsementRate: (stats.positiveEndorsements / stats.count) * 100,
            totalEndorsements: stats.count,
            growthRate
        };
    });

    return {
        skillStats,
        skillTrends,
        topSkills: sortTopSkills(topSkills),
        growthInsights: identifyGrowthAreas(skillGrowth),
        recommendations: generateRecommendations(skillStats, skillGrowth)
    };
}

/**
 * Helper function to calculate skill growth rate
 */
function calculateGrowthRate(trends, skill) {
    const months = Object.keys(trends).sort();
    if (months.length < 2) return 0;

    const previousMonth = trends[months[months.length - 2]][skill] || 0;
    const currentMonth = trends[months[months.length - 1]][skill] || 0;

    return previousMonth === 0 ? 100 : 
        ((currentMonth - previousMonth) / previousMonth) * 100;
}

/**
 * Helper function to sort and return top skills
 */
function sortTopSkills(skills) {
    return Object.entries(skills)
        .sort(([, a], [, b]) => b.endorsementRate - a.endorsementRate)
        .slice(0, 5)
        .reduce((obj, [key, value]) => ({...obj, [key]: value}), {});
}

/**
 * Helper function to identify growth areas
 */
function identifyGrowthAreas(growthRates) {
    return Object.entries(growthRates)
        .sort(([, a], [, b]) => b - a)
        .reduce((obj, [skill, rate]) => ({
            ...obj,
            [skill]: {
                growthRate: rate,
                trend: rate > 20 ? 'Rising' : rate < -10 ? 'Declining' : 'Stable'
            }
        }), {});
}

/**
 * Helper function to generate recommendations
 */
function generateRecommendations(stats, growth) {
    const recommendations = [];

    Object.entries(stats).forEach(([skill, data]) => {
        if (data.count < 3) {
            recommendations.push({
                skill,
                type: 'improvement',
                message: `Consider gathering more endorsements for ${skill}`
            });
        }
        if (growth[skill] < -10) {
            recommendations.push({
                skill,
                type: 'attention',
                message: `${skill} shows declining trend, focus on highlighting this skill`
            });
        }
    });

    return recommendations;
}

export {
    getSkills,
    addSkill,
    updateSkill,
    deleteSkill,
    getSkillInsights
};