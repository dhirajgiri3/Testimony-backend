import StatsD from 'hot-shots';
import { logger } from './logger.js';
import dotenv from 'dotenv';

dotenv.config();

// Configure StatsD client
const statsd = new StatsD({
    host: process.env.STATSD_HOST || 'localhost',
    port: process.env.STATSD_PORT || 8125,
    prefix: 'testimony.',
    errorHandler: (error) => {
        logger.error('StatsD error:', error);
    },
    mock: process.env.NODE_ENV === 'test'
});

// Helper function to format tags
const formatTags = (tags = {}) => 
    Object.entries(tags)
        .map(([key, value]) => `${key}:${value}`)
        .filter(Boolean);

// Core metric functions
export const increment = (name, value = 1, tags = {}) => {
    try {
        statsd.increment(name, value, formatTags(tags));
    } catch (error) {
        logger.warn(`Failed to increment metric ${name}:`, error);
    }
};

export const timing = (name, value, tags = {}) => {
    try {
        statsd.timing(name, value, formatTags(tags));
    } catch (error) {
        logger.warn(`Failed to record timing metric ${name}:`, error);
    }
};

export const gauge = (name, value, tags = {}) => {
    try {
        statsd.gauge(name, value, formatTags(tags));
    } catch (error) {
        logger.warn(`Failed to record gauge metric ${name}:`, error);
    }
};

export const histogram = (name, value, tags = {}) => {
    try {
        statsd.histogram(name, value, formatTags(tags));
    } catch (error) {
        logger.warn(`Failed to record histogram metric ${name}:`, error);
    }
};

export const timeAsync = async (name, fn, tags = {}) => {
    const start = Date.now();
    try {
        return await fn();
    } finally {
        const duration = Date.now() - start;
        timing(name, duration, tags);
    }
};

export const close = () => statsd.close();

// Metric name constants
export const MetricNames = {
    TESTIMONIAL_CREATED: 'testimonial.created',
    TESTIMONIAL_SUBMITTED: 'testimonial.submitted',
    TESTIMONIAL_APPROVED: 'testimonial.approved',
    TESTIMONIAL_REJECTED: 'testimonial.rejected',
    TESTIMONIAL_REPORTED: 'testimonial.reported',
    TESTIMONIAL_SHARED: 'testimonial.shared',
    TESTIMONIAL_ARCHIVED: 'testimonial.archived',
    TESTIMONIAL_RESTORED: 'testimonial.restored',
    TESTIMONIAL_DELETED: 'testimonial.deleted',
    API_REQUEST: 'api.request',
    API_ERROR: 'api.error',
    CACHE_HIT: 'cache.hit',
    CACHE_MISS: 'cache.miss',
    EMAIL_SENT: 'email.sent',
    EMAIL_ERROR: 'email.error'
};

// Tag constants
export const MetricTags = {
    STATUS: 'status',
    PLATFORM: 'platform',
    USER_TYPE: 'user_type',
    ERROR_TYPE: 'error_type',
    SOURCE: 'source'
};

// Export all functions as a metrics object for backwards compatibility
export const metrics = {
    increment,
    timing,
    gauge,
    histogram,
    timeAsync,
    close
};

export default metrics;