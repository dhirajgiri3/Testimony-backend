// utils/inputValidation.js

import AppError from './appError.js';

/**
 * Validate password strength
 * @param {string} password
 */
const validatePasswordStrength = (password) => {
  const passwordRegex =
    /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
  if (!passwordRegex.test(password)) {
    throw new AppError(
      'Password must be minimum eight characters, including at least one letter, one number, and one special character.',
      400
    );
  }
};

/**
 * Normalize phone number to E.164 format
 * @param {string} phone
 * @returns {string}
 */
const normalizePhoneNumber = (phone) => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  throw new AppError('Invalid phone number format.', 400);
};

/**
 * Sanitize input to prevent XSS attacks
 * @param {any} input
 * @returns {any}
 */
const sanitizeInput = (input) => {
  const escapeString = (str) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  if (typeof input === 'string') {
    return escapeString(input);
  }
  if (typeof input === 'object' && input !== null) {
    const sanitizedObject = {};
    for (const key in input) {
      sanitizedObject[key] = sanitizeInput(input[key]);
    }
    return sanitizedObject;
  }
  return input;
};

export { validatePasswordStrength, normalizePhoneNumber, sanitizeInput };
