// src/controllers/predictiveController.js

import asyncHandler from "express-async-handler";
import Analytics from "../models/Analytics.js";
import Testimonial from "../models/Testimonial.js";
import AppError from "../utils/appError.js";
import { logger } from "../utils/logger.js";

/**
 * @desc    Get Advanced Predictive Insights
 * @route   GET /api/v1/predictive/insights
 * @access  Private (Seeker)
 */
export const getPredictiveInsights = asyncHandler(async (req, res, next) => {
    const { timespan = '6months' } = req.query;

    if (!req.user?.id) {
        return next(new AppError("User authentication required", 401));
    }

    try {
        // Get base analytics
        const analytics = await Analytics.findOne({ seeker: req.user.id }).lean();
        if (!analytics) {
            return next(new AppError("No analytics data available", 404));
        }

        // Get historical testimonial data
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(endDate.getMonth() - (timespan === '12months' ? 12 : 6));

        const testimonials = await Testimonial.find({
            seeker: req.user.id,
            createdAt: { $gte: startDate, $lte: endDate }
        }).lean();

        // Generate predictive insights
        const predictiveData = generatePredictiveInsights(testimonials, analytics);

        // Update analytics with new predictions
        await Analytics.findOneAndUpdate(
            { seeker: req.user.id },
            { 
                $set: { 
                    forecast: predictiveData,
                    lastPredictionUpdate: new Date()
                }
            },
            { new: true }
        );

        res.status(200).json({
            success: true,
            data: predictiveData
        });

    } catch (error) {
        logger.error("Error in predictive insights:", error);
        return next(new AppError("Failed to generate predictive insights", 500));
    }
});

/**
 * @desc    Get forecasted testimonials trend for a seeker
 * @route   GET /api/v1/predictive/forecast/:seekerId
 * @access  Protected
 */
export const getForecast = asyncHandler(async (req, res, next) => {
    const { seekerId } = req.params;

    try {
        const analytics = await Analytics.findOne({ seeker: seekerId }).lean();
        if (!analytics) {
            return next(new AppError("No analytics data available", 404));
        }

        res.status(200).json({
            success: true,
            data: analytics.forecast
        });
    } catch (error) {
        logger.error("Error in getting forecast:", error);
        return next(new AppError("Failed to get forecast", 500));
    }
});

/**
 * Helper function to generate predictive insights
 */
function generatePredictiveInsights(testimonials, analytics) {
    const timeBasedMetrics = calculateTimeBasedMetrics(testimonials);
    const skillTrends = analyzeSkillTrends(testimonials);
    const growthPredictions = predictGrowthPatterns(timeBasedMetrics);
    const recommendedActions = generateRecommendedActions(skillTrends, growthPredictions);

    return {
        metrics: timeBasedMetrics,
        skillPredictions: skillTrends,
        growthForecast: growthPredictions,
        recommendations: recommendedActions,
        confidence: calculateConfidenceScore(testimonials.length),
        nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
    };
}

function calculateTimeBasedMetrics(testimonials) {
    const monthlyData = {};
    
    testimonials.forEach(testimonial => {
        const month = testimonial.createdAt.toISOString().slice(0, 7);
        if (!monthlyData[month]) {
            monthlyData[month] = {
                count: 0,
                positiveCount: 0,
                skills: new Set()
            };
        }
        
        monthlyData[month].count++;
        if (testimonial.feedback?.sentiment === 'positive') {
            monthlyData[month].positiveCount++;
        }
        testimonial.skills?.forEach(skill => {
            monthlyData[month].skills.add(skill.name);
        });
    });

    return Object.entries(monthlyData).map(([month, data]) => ({
        month,
        testimonialCount: data.count,
        positiveRate: (data.positiveCount / data.count) * 100,
        uniqueSkills: Array.from(data.skills).length
    }));
}

function analyzeSkillTrends(testimonials) {
    const skillMap = new Map();

    testimonials.forEach(testimonial => {
        testimonial.skills?.forEach(skill => {
            if (!skillMap.has(skill.name)) {
                skillMap.set(skill.name, {
                    mentions: 0,
                    recentMentions: 0,
                    growth: 0
                });
            }

            const skillData = skillMap.get(skill.name);
            skillData.mentions++;

            // Count mentions in the last month
            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
            if (testimonial.createdAt >= oneMonthAgo) {
                skillData.recentMentions++;
            }
        });
    });

    return Array.from(skillMap.entries()).map(([skill, data]) => ({
        skill,
        trend: data.recentMentions / (data.mentions - data.recentMentions),
        predictedGrowth: data.recentMentions * 2 - (data.mentions - data.recentMentions)
    }));
}

function predictGrowthPatterns(metrics) {
    // Simple linear regression for growth prediction
    const recentMetrics = metrics.slice(-3);
    const growthRate = recentMetrics.reduce((acc, curr, idx, arr) => {
        if (idx === 0) return acc;
        return acc + (curr.testimonialCount - arr[idx - 1].testimonialCount);
    }, 0) / (recentMetrics.length - 1);

    return {
        predicted30Days: Math.max(0, recentMetrics[recentMetrics.length - 1].testimonialCount + growthRate),
        predictedGrowthRate: growthRate,
        trend: growthRate > 0 ? 'Upward' : growthRate < 0 ? 'Downward' : 'Stable'
    };
}

function generateRecommendedActions(skillTrends, growthPredictions) {
    const recommendations = [];

    // Growth-based recommendations
    if (growthPredictions.trend === 'Downward') {
        recommendations.push({
            type: 'growth',
            priority: 'high',
            action: 'Increase engagement to improve testimonial collection rate'
        });
    }

    // Skill-based recommendations
    skillTrends
        .filter(trend => trend.predictedGrowth < 0)
        .forEach(trend => {
            recommendations.push({
                type: 'skill',
                priority: 'medium',
                action: `Focus on highlighting ${trend.skill} in upcoming opportunities`
            });
        });

    return recommendations;
}

function calculateConfidenceScore(sampleSize) {
    // Simple confidence score based on sample size
    const baseScore = Math.min(100, (sampleSize / 10) * 100);
    return Math.round(baseScore * 100) / 100;
}