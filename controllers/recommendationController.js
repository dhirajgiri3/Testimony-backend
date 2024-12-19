// src/controllers/recommendationController.js

import asyncHandler from "express-async-handler";
import Analytics from "../models/Analytics.js";
import Testimonial from "../models/Testimonial.js";
import AppError from "../utils/appError.js";
import { logger } from "../utils/logger.js";

/**
 * @desc    Get Advanced Personalized Recommendations
 * @route   GET /api/v1/recommendations
 * @access  Private (Seeker)
 */
export const getRecommendations = asyncHandler(async (req, res, next) => {
    const { timeframe = '6months' } = req.query;

    try {
        // Get user analytics and recent testimonials
        const [analytics, recentTestimonials] = await Promise.all([
            Analytics.findOne({ seeker: req.user.id }).lean(),
            Testimonial.find({
                seeker: req.user.id,
                createdAt: {
                    $gte: new Date(Date.now() - parseInt(timeframe) * 30 * 24 * 60 * 60 * 1000)
                }
            }).lean()
        ]);

        if (!analytics) {
            throw new AppError("No analytics data available", 404);
        }

        // Generate comprehensive recommendations
        const recommendations = await generateComprehensiveRecommendations(
            recentTestimonials,
            analytics
        );

        // Update analytics with new recommendations
        await Analytics.findOneAndUpdate(
            { seeker: req.user.id },
            { 
                $set: { 
                    recommendations,
                    lastRecommendationUpdate: new Date()
                }
            },
            { new: true }
        );

        res.status(200).json({
            success: true,
            data: recommendations
        });

    } catch (error) {
        logger.error("Error generating recommendations:", error);
        next(new AppError("Failed to generate recommendations", 500));
    }
});

/**
 * Generate comprehensive recommendations using multiple algorithms
 */
async function generateComprehensiveRecommendations(testimonials, analytics) {
    const skillGapAnalysis = analyzeSkillGaps(testimonials);
    const engagementMetrics = calculateEngagementMetrics(testimonials);
    const growthOpportunities = identifyGrowthOpportunities(analytics);
    
    return {
        skillRecommendations: generateSkillRecommendations(skillGapAnalysis),
        engagementRecommendations: generateEngagementRecommendations(engagementMetrics),
        growthRecommendations: generateGrowthRecommendations(growthOpportunities),
        priority: calculateRecommendationPriorities(skillGapAnalysis, engagementMetrics, growthOpportunities),
        lastUpdated: new Date(),
        confidenceScore: calculateConfidenceScore(testimonials.length, analytics)
    };
}

function analyzeSkillGaps(testimonials) {
    const skillFrequency = new Map();
    const recentSkills = new Set();
    const skillTrends = new Map();

    testimonials.forEach(testimonial => {
        const isRecent = new Date(testimonial.createdAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        
        testimonial.skills?.forEach(skill => {
            // Track skill frequency
            skillFrequency.set(skill.name, (skillFrequency.get(skill.name) || 0) + 1);
            
            // Track recent skills
            if (isRecent) {
                recentSkills.add(skill.name);
            }

            // Analyze skill trends
            if (!skillTrends.has(skill.name)) {
                skillTrends.set(skill.name, { recent: 0, old: 0 });
            }
            const trend = skillTrends.get(skill.name);
            isRecent ? trend.recent++ : trend.old++;
        });
    });

    return {
        frequency: Object.fromEntries(skillFrequency),
        recent: Array.from(recentSkills),
        trends: Object.fromEntries(skillTrends),
        gaps: identifySkillGaps(skillFrequency, recentSkills)
    };
}

function calculateEngagementMetrics(testimonials) {
    const timeIntervals = testimonials.map((t, i, arr) => {
        if (i === 0) return null;
        return new Date(t.createdAt) - new Date(arr[i - 1].createdAt);
    }).filter(Boolean);

    return {
        frequency: testimonials.length,
        averageInterval: timeIntervals.reduce((a, b) => a + b, 0) / timeIntervals.length,
        consistency: calculateConsistencyScore(timeIntervals),
        recentEngagement: calculateRecentEngagement(testimonials)
    };
}

function identifyGrowthOpportunities(analytics) {
    const trends = analytics.forecast?.metrics || [];
    const recentTrends = trends.slice(-3);
    
    return {
        growthRate: calculateGrowthRate(recentTrends),
        potentialAreas: identifyPotentialGrowthAreas(analytics),
        riskAreas: identifyRiskAreas(analytics),
        opportunityScore: calculateOpportunityScore(analytics)
    };
}

function generateSkillRecommendations(skillAnalysis) {
    return Object.entries(skillAnalysis.gaps)
        .map(([skill, score]) => ({
            skill,
            action: `Focus on strengthening ${skill}`,
            priority: score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low',
            rationale: `Based on ${Math.round(score * 100)}% gap in recent testimonials`
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
}

function calculateConfidenceScore(sampleSize, analytics) {
    const baseScore = Math.min(100, (sampleSize / 10) * 100);
    const qualityScore = analytics.forecast?.confidence || 50;
    const recencyScore = calculateRecencyScore(analytics.lastRecommendationUpdate);
    
    return Math.round((baseScore + qualityScore + recencyScore) / 3);
}

// Additional helper functions
function identifySkillGaps(skillFrequency, recentSkills) {
    const gaps = {};
    const allSkills = new Set([...skillFrequency.keys()]);
    
    allSkills.forEach(skill => {
        const isRecent = recentSkills.has(skill);
        const frequency = skillFrequency.get(skill) || 0;
        gaps[skill] = calculateGapScore(frequency, isRecent);
    });
    
    return gaps;
}

function calculateConsistencyScore(intervals) {
    if (intervals.length < 2) return 0;
    const variance = calculateVariance(intervals);
    return Math.max(0, 1 - (variance / Math.max(...intervals)));
}

function calculateRecentEngagement(testimonials) {
    const recentCount = testimonials.filter(t => 
        new Date(t.createdAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    ).length;
    return recentCount / testimonials.length;
}

function calculateRecencyScore(lastUpdate) {
    if (!lastUpdate) return 0;
    const daysSinceUpdate = (Date.now() - new Date(lastUpdate)) / (24 * 60 * 60 * 1000);
    return Math.max(0, 100 - (daysSinceUpdate * 2));
}

function calculateVariance(numbers) {
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    return numbers.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / numbers.length;
}

function calculateGapScore(frequency, isRecent) {
    return isRecent ? 0 : 1 - (frequency / 10);
}

function calculateGrowthRate(trends) {
    if (trends.length < 2) return 0;
    const [prev, curr] = trends.slice(-2);
    return ((curr.testimonialCount - prev.testimonialCount) / prev.testimonialCount) * 100;
}

function identifyPotentialGrowthAreas(analytics) {
    const skills = analytics.skills?.skillStats || {};
    const forecast = analytics.forecast?.skillPredictions || [];
    
    return Object.entries(skills)
        .map(([skill, stats]) => {
            const prediction = forecast.find(f => f.skill === skill);
            const growth = prediction?.predictedGrowth || 0;
            
            return {
                skill,
                growthPotential: growth > 0 ? growth : 0,
                currentStrength: (stats.positiveEndorsements / stats.count) * 100,
                recommendation: growth > 20 ? 'high-potential' : growth > 0 ? 'maintain' : 'needs-attention'
            };
        })
        .filter(area => area.growthPotential > 0)
        .sort((a, b) => b.growthPotential - a.growthPotential);
}

function identifyRiskAreas(analytics) {
    const skills = analytics.skills?.skillStats || {};
    const trends = analytics.skills?.skillTrends || {};
    
    return Object.entries(skills)
        .map(([skill, stats]) => {
            const trendData = Object.values(trends).filter(t => t[skill]);
            const recentTrend = trendData.slice(-3);
            const declining = recentTrend.every((val, i, arr) => 
                i === 0 || val[skill] < arr[i-1][skill]
            );
            
            return {
                skill,
                riskLevel: declining ? 'high' : 'low',
                endorsementRate: (stats.positiveEndorsements / stats.count) * 100,
                lastMention: getLastMentionDate(trends, skill)
            };
        })
        .filter(area => area.riskLevel === 'high');
}

function calculateOpportunityScore(analytics) {
    const baseScore = analytics.forecast?.confidence || 50;
    const skillScores = analytics.skills?.topSkills || {};
    const recentGrowth = analytics.forecast?.growthForecast?.predictedGrowthRate || 0;
    
    const skillScore = Object.values(skillScores)
        .reduce((acc, curr) => acc + curr.endorsementRate, 0) / 
        (Object.keys(skillScores).length || 1);
    
    const growthScore = Math.max(0, Math.min(100, recentGrowth * 10));
    
    return Math.round((baseScore + skillScore + growthScore) / 3);
}

function generateEngagementRecommendations(metrics) {
    const recommendations = [];
    
    if (metrics.frequency < 5) {
        recommendations.push({
            type: 'frequency',
            priority: 'high',
            action: 'Increase testimonial collection frequency',
            rationale: 'Low testimonial count in recent period'
        });
    }
    
    if (metrics.consistency < 0.5) {
        recommendations.push({
            type: 'consistency',
            priority: 'medium',
            action: 'Maintain regular testimonial collection',
            rationale: 'Inconsistent collection patterns detected'
        });
    }
    
    if (metrics.recentEngagement < 0.3) {
        recommendations.push({
            type: 'engagement',
            priority: 'high',
            action: 'Re-engage with testimonial collection',
            rationale: 'Low recent activity detected'
        });
    }
    
    return recommendations;
}

function generateGrowthRecommendations(opportunities) {
    return opportunities.potentialAreas
        .map(area => ({
            type: 'growth',
            skill: area.skill,
            priority: area.growthPotential > 50 ? 'high' : 'medium',
            action: `Focus on developing ${area.skill}`,
            rationale: `${Math.round(area.growthPotential)}% growth potential identified`,
            metrics: {
                currentStrength: area.currentStrength,
                growthPotential: area.growthPotential
            }
        }))
        .slice(0, 3);
}

function calculateRecommendationPriorities(skillGaps, engagement, growth) {
    const priorities = {
        immediate: [],
        short_term: [],
        long_term: []
    };
    
    // Prioritize skill gaps
    Object.entries(skillGaps.gaps)
        .forEach(([skill, score]) => {
            const category = score > 0.7 ? 'immediate' : 
                           score > 0.4 ? 'short_term' : 
                           'long_term';
            priorities[category].push({
                type: 'skill_gap',
                skill,
                score
            });
        });
    
    // Add engagement priorities
    if (engagement.frequency < 5 || engagement.recentEngagement < 0.3) {
        priorities.immediate.push({
            type: 'engagement',
            metric: 'frequency',
            score: engagement.recentEngagement
        });
    }
    
    // Add growth priorities
    if (growth.growthRate < 0) {
        priorities.short_term.push({
            type: 'growth',
            metric: 'growth_rate',
            score: growth.growthRate
        });
    }
    
    return priorities;
}

function getLastMentionDate(trends, skill) {
    const dates = Object.keys(trends)
        .filter(date => trends[date][skill])
        .sort()
        .reverse();
    return dates[0] || null;
}

// Export all utility functions for testing and reuse
export {
    identifySkillGaps,
    calculateConsistencyScore,
    calculateRecentEngagement,
    calculateRecencyScore,
    calculateVariance,
    identifyPotentialGrowthAreas,
    identifyRiskAreas,
    calculateOpportunityScore,
    generateEngagementRecommendations,
    generateGrowthRecommendations,
    calculateRecommendationPriorities,
    getLastMentionDate
};