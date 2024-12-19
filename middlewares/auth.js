import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import { isTokenBlacklisted } from '../services/tokenBlacklistService.js';
import { createError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import rateLimit from 'express-rate-limit';
import csrf from 'csurf';

// Initialize CSRF protection
const csrfProtection = csrf({ cookie: true });

/**
 * Protect routes by verifying JWT tokens from HttpOnly cookies
 */
export const protect = [
    rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        message: 'Too many requests from this IP, please try again later.'
    }),
    csrfProtection,
    asyncHandler(async (req, res, next) => {
        let accessToken;

        // Check for token in cookies
        if (req.cookies && req.cookies.access_token) {
            accessToken = req.cookies.access_token;
        }

        if (!accessToken) {
            return next(createError('authentication', 'Not authorized to access this route', 401));
        }

        // Check if token is blacklisted
        const isBlacklisted = await isTokenBlacklisted(accessToken);
        if (isBlacklisted) {
            return next(createError('authentication', 'Token has been revoked', 401));
        }

        try {
            const decoded = jwt.verify(accessToken, process.env.JWT_ACCESS_SECRET);

            const user = await User.findById(decoded.id);
            if (!user) {
                return next(createError('authentication', 'No user found with this ID', 404));
            }

            // Check if user changed password after token was issued
            if (user.passwordChangedAfter(decoded.iat)) {
                return next(createError('authentication', 'User recently changed password. Please log in again.', 401));
            }

            req.user = user;
            next();
        } catch (error) {
            logger.error('Authentication error:', error);
            return next(createError('authentication', 'Not authorized to access this route', 401));
        }
    })
];

/**
 * Authorize based on user roles
 * @param  {...any} roles - Allowed roles
 */
export const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return next(createError('authorization', 'You do not have permission to perform this action', 403));
        }
        next();
    };
};
