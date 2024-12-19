
import AppError from './appError.js';

export const validatePasswordStrength = (password) => {
    const requirements = [
      {
        test: (pwd) => pwd.length >= 8,
        message: "Password must be at least 8 characters long"
      },
      {
        test: (pwd) => /[A-Z]/.test(pwd),
        message: "Password must contain at least one uppercase letter"
      },
      {
        test: (pwd) => /[a-z]/.test(pwd),
        message: "Password must contain at least one lowercase letter"
      },
      {
        test: (pwd) => /[0-9]/.test(pwd),
        message: "Password must contain at least one number"
      },
      {
        test: (pwd) => /[^A-Za-z0-9]/.test(pwd),
        message: "Password must contain at least one special character"
      },
      {
        test: (pwd) => !/\s/.test(pwd),
        message: "Password must not contain whitespace"
      },
      {
        test: (pwd) => !/(password|123456|admin)/i.test(pwd),
        message: "Password contains common phrases and is too weak"
      }
    ];
  
    const failedRequirements = requirements
      .filter(req => !req.test(password))
      .map(req => req.message);
  
    if (failedRequirements.length > 0) {
      throw new AppError(failedRequirements.join('. '), 400);
    }
  };


export const normalizePhoneNumber = (phone) => {
    if (!phone || typeof phone !== 'string') {
        throw new AppError('Phone number is required and must be a string', 400);
    }

    // Remove all whitespace, dots, dashes, parentheses
    let normalized = phone.replace(/[\s\.\-\(\)]/g, '');

    // Check if it's already in E.164 format (starts with +)
    const isE164 = normalized.startsWith('+');
    if (isE164) {
        normalized = normalized.substring(1);
    }

    // Remove any non-digit characters
    normalized = normalized.replace(/\D/g, '');

    // Validate basic length
    if (normalized.length < 10 || normalized.length > 15) {
        throw new AppError('Phone number length is invalid (must be 10-15 digits)', 400);
    }

    // Handle different country number formats
    // For numbers without country code, assume US/Canada (1)
    if (normalized.length === 10) {
        normalized = '1' + normalized;
    }

    // Validate against common invalid patterns
    if (/^0{5,}/.test(normalized) || /^1{5,}/.test(normalized)) {
        throw new AppError('Invalid phone number pattern', 400);
    }

    // Final E.164 format validation
    const e164Regex = /^\d{10,14}$/;
    if (!e164Regex.test(normalized)) {
        throw new AppError('Phone number format is invalid', 400);
    }

    // Return in E.164 format
    return '+' + normalized;
};