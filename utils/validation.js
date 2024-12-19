// src/utils/validation.js
import validator from 'validator';
import xss from 'xss';
import { logger } from './logger.js';

/**
 * Sanitizes input string to prevent XSS attacks
 * @param {string} input - The input string to sanitize
 * @returns {string} Sanitized string
 */
export const sanitizeInput = (input) => {
    if (typeof input !== 'string') {
        return '';
    }
    return xss(validator.trim(input));
};

/**
 * Validates email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if email is valid
 */
export const isValidEmail = (email) => {
    if (!email || typeof email !== 'string') return false;
    return validator.isEmail(email);
};

/**
 * Validates password strength
 * @param {string} password - Password to validate
 * @returns {boolean} True if password meets requirements
 */
export const isValidPassword = (password) => {
    if (!password || typeof password !== 'string') return false;
    return (
        password.length >= 8 &&
        /[A-Z]/.test(password) &&
        /[a-z]/.test(password) &&
        /[0-9]/.test(password) &&
        /[!@#$%^&*]/.test(password)
    );
};

/**
 * Validates MongoDB ObjectId
 * @param {string} id - ID to validate
 * @returns {boolean} True if ID is valid MongoDB ObjectId
 */
export const isValidObjectId = (id) => {
    if (!id || typeof id !== 'string') return false;
    return /^[0-9a-fA-F]{24}$/.test(id);
};

/**
 * Validates testimonial text
 * @param {string} text - Testimonial text to validate
 * @returns {boolean} True if testimonial text is valid
 */
export const isValidTestimonialText = (text) => {
    if (!text || typeof text !== 'string') return false;
    const sanitizedText = sanitizeInput(text);
    return sanitizedText.length >= 10 && sanitizedText.length <= 5000;
};

/**
 * Validates rating value
 * @param {number} rating - Rating to validate
 * @returns {boolean} True if rating is valid
 */
export const isValidRating = (rating) => {
    return typeof rating === 'number' && rating >= 1 && rating <= 5;
};

/**
 * Validates array of skills
 * @param {Array} skills - Array of skills to validate
 * @returns {boolean} True if skills array is valid
 */
export const isValidSkillsArray = (skills) => {
    if (!Array.isArray(skills)) return false;
    return skills.every(skill => 
        typeof skill === 'string' && 
        skill.trim().length > 0 && 
        skill.trim().length <= 50
    );
};

/**
 * Validates URL string
 * @param {string} url - URL to validate
 * @returns {boolean} True if URL is valid
 */
export const isValidURL = (url) => {
    try {
        return validator.isURL(url, {
            protocols: ['http', 'https'],
            require_protocol: true
        });
    } catch (error) {
        logger.error('URL validation error:', error);
        return false;
    }
};

export default {
    sanitizeInput,
    isValidEmail,
    isValidPassword,
    isValidObjectId,
    isValidTestimonialText,
    isValidRating,
    isValidSkillsArray,
    isValidURL
};