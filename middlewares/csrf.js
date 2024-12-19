
import csrf from 'csurf';
import { createError } from '../utils/errors.js';

/**
 * Initialize CSRF protection
 */
const csrfProtection = csrf({ cookie: true });

/**
 * Middleware to handle CSRF errors
 */
export const handleCsrfError = (err, req, res, next) => {
    if (err.code !== 'EBADCSRFTOKEN') return next(err);

    // Handle CSRF token errors here
    return next(createError('csrf', 'Invalid CSRF token', 403));
};

export default csrfProtection;