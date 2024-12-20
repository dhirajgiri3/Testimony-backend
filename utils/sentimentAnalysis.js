// src/services/analyticsService.js

import Testimonial from '../models/Testimonial.js';
import { logger } from '../utils/logger.js';
import AppError from '../utils/appError.js';
import { analyzeSentiment } from '../services/sentimentService.js';
import { redis } from '../config/redis.js';

/**
 * Calculate and update analytics for a testimonial
 * @param {string} testimonialId 
 * @returns {Promise<Object>} Updated analytics
 */
export const updateTestimonialAnalytics = async (testimonialId) => {
    try {
        const testimonial = await Testimonial.findById(testimonialId);
        if (!testimonial) {
            throw new AppError('Testimonial not found', 404);
        }

        // Calculate ratings analytics
        const ratingsAnalytics = calculateRatingsAnalytics(testimonial);
        
        // Calculate sentiment analytics
        const sentimentAnalytics = await calculateSentimentAnalytics(testimonial);

        // Update testimonial with new analytics
        const updates = {
            'analytics.ratings': ratingsAnalytics,
            'analytics.sentimentAnalysis': sentimentAnalytics,
            'analytics.lastUpdated': new Date()
        };

        const updatedTestimonial = await Testimonial.findByIdAndUpdate(
            testimonialId,
            { $set: updates },
            { new: true }
        );

        logger.info(`✅ Analytics updated for testimonial ${testimonialId}`);
        return updatedTestimonial.analytics;

    } catch (error) {
        logger.error(`❌ Failed to update analytics for testimonial ${testimonialId}:`, error);
        throw new AppError('Analytics update failed', 500);
    }
};

/**
 * Calculate ratings analytics
 * @param {Object} testimonial 
 * @returns {Object} Ratings analytics
 */
const calculateRatingsAnalytics = (testimonial) => {
    const ratings = testimonial.givers
        .map(g => g.testimonial?.rating?.overall)
        .filter(Boolean);

    return {
        average: ratings.length ? 
            ratings.reduce((acc, curr) => acc + curr, 0) / ratings.length : 0,
        count: ratings.length,
        distribution: ratings.reduce((acc, rating) => {
            acc[rating] = (acc[rating] || 0) + 1;
            return acc;
        }, {})
    };
};

/**
 * Calculate sentiment analytics
 * @param {Object} testimonial 
 * @returns {Promise<Object>} Sentiment analytics
 */
export const calculateSentimentAnalytics = async (testimonial) => {
    const cacheKey = `sentiment:${testimonial._id}`;
    
    // Try to get from cache
    const cached = await redis.get(cacheKey);
    if (cached) {
        return JSON.parse(cached);
    }

    const texts = testimonial.givers
        .map(g => g.testimonial?.text)
        .filter(Boolean);

    if (!texts.length) {
        return {
            overallScore: 0,
            status: 'no_content'
        };
    }

    const sentimentScores = await analyzeSentiment(texts);
    
    const analytics = {
        overallScore: sentimentScores.reduce((acc, score) => acc + score, 0) / sentimentScores.length,
        scores: sentimentScores,
        status: 'analyzed',
        timestamp: new Date()
    };

    // Cache results for 1 hour
    await redis.set(cacheKey, JSON.stringify(analytics), 'EX', 3600);

    return analytics;
};