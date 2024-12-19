// /backend/utils/validators.js

import { body, param, query, validationResult } from "express-validator";
import Joi from "joi";
import AppError from "./appError.js";

// Enhanced Regular Expressions for validation
const REGEX = {
  password:
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  phone: /^\+[1-9]\d{1,14}$/,
  username: /^[a-zA-Z0-9_-]{3,30}$/,
  url: /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/,
  objectId: /^[0-9a-fA-F]{24}$/,
  hexColor: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
  base64Image: /^data:image\/(jpeg|jpg|png|gif);base64,/i,
  linkedinUrl: /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]{5,30}[a-zA-Z0-9]$/,
  githubUrl: /^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9-]{1,39}$/,
  twitterUrl: /^https?:\/\/(www\.)?twitter\.com\/[a-zA-Z0-9_]{1,15}$/,
};

// Common validation helpers
const commonValidators = {
  string: (
    fieldName,
    { min = 1, max = 50, required = true, regex = null, regexMessage = "" } = {}
  ) => {
    let validator = body(fieldName)
      .if((value, { req }) => required || value)
      .trim()
      .notEmpty()
      .withMessage(`${fieldName} is required`)
      .isLength({ min, max })
      .withMessage(`${fieldName} must be between ${min} and ${max} characters`);

    if (regex) {
      validator = validator
        .matches(regex)
        .withMessage(regexMessage || `${fieldName} is invalid`);
    }

    return validator;
  },

  email: (fieldName = "email", required = true) =>
    body(fieldName)
      .if((value, { req }) => required || value)
      .trim()
      .normalizeEmail()
      .isEmail()
      .withMessage("Invalid email address"),

  boolean: (fieldName, required = true) =>
    body(fieldName)
      .if((value, { req }) => required || value !== undefined)
      .isBoolean()
      .withMessage(`${fieldName} must be a boolean`),

  enum: (fieldName, values, required = true) =>
    body(fieldName)
      .if((value, { req }) => required || value)
      .isIn(values)
      .withMessage(`${fieldName} must be one of: ${values.join(", ")}`),

  number: (fieldName, { min, max, required = true } = {}) => {
    let validator = body(fieldName)
      .if((value, { req }) => required || value)
      .isNumeric()
      .withMessage(`${fieldName} must be a number`);

    if (min !== undefined) {
      validator = validator
        .isInt({ min })
        .withMessage(`${fieldName} must be at least ${min}`);
    }

    if (max !== undefined) {
      validator = validator
        .isInt({ max })
        .withMessage(`${fieldName} must not exceed ${max}`);
    }

    return validator;
  },

  objectId: (fieldName, location = "param") =>
    (location === "param" ? param(fieldName) : body(fieldName))
      .matches(REGEX.objectId)
      .withMessage("Invalid ID format"),
};

// Authentication Validators
export const authValidators = {
  register: [
    commonValidators.string("firstName", { max: 30 }),
    commonValidators.string("lastName", { max: 30 }),
    commonValidators.string("email", {
      regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      regexMessage: "Invalid email format",
    }),
    body("username")
      .matches(/^[a-zA-Z0-9_-]{3,30}$/)
      .withMessage(
        "Username must be 3-30 characters and can contain letters, numbers, underscore, and hyphen"
      ),
    body("password")
      .matches(REGEX.password)
      .withMessage(
        "Password must contain uppercase, lowercase, number, and special character"
      ),
    body("confirmPassword").custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error("Passwords do not match");
      }
      return true;
    }),
    commonValidators.string("phone", { required: false }),
  ],

  login: [commonValidators.email("email"), commonValidators.string("password")],

  forgotPassword: [commonValidators.email("email")],

  resetPassword: [
    body("token").notEmpty().withMessage("Token is required"),
    body("newPassword")
      .matches(REGEX.password)
      .withMessage(
        "Password must contain uppercase, lowercase, number, and special character"
      ),
    body("confirmPassword").custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error("Passwords do not match");
      }
      return true;
    }),
  ],
};

// User Profile Validators
export const profileValidators = {
  updateProfile: [
    commonValidators.string("firstName", { required: false, max: 30 }),
    commonValidators.string("lastName", { required: false, max: 30 }),
    commonValidators
      .string("email", { required: false })
      .matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
      .withMessage("Invalid email format"),
    commonValidators.string("bio", { required: false, max: 500 }),
    commonValidators.string("location", { required: false, max: 100 }),
    body("socialLinks.linkedin")
      .optional()
      .matches(REGEX.linkedinUrl)
      .withMessage("Invalid LinkedIn URL"),
    body("socialLinks.github")
      .optional()
      .matches(REGEX.githubUrl)
      .withMessage("Invalid GitHub URL"),
    body("socialLinks.twitter")
      .optional()
      .matches(REGEX.twitterUrl)
      .withMessage("Invalid Twitter URL"),
  ],

  updatePreferences: [
    body("notifications").optional().isObject(),
    body("notifications.*.email").optional().isBoolean(),
    body("notifications.*.push").optional().isBoolean(),
    body("privacy.profileVisibility")
      .optional()
      .isIn(["public", "private", "connections"]),
    body("privacy.testimonialVisibility")
      .optional()
      .isIn(["public", "private", "connections"]),
    body("display.theme").optional().isIn(["light", "dark", "system"]),
    body("display.compactView").optional().isBoolean(),
  ],

  updateSettings: [
    body("language").optional().isString().isLength({ min: 2, max: 5 }),
    body("timezone").optional().isString(),
    body("dateFormat")
      .optional()
      .isIn(["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]),
    body("timeFormat").optional().isIn(["12h", "24h"]),
    body("currency").optional().isString().isLength({ min: 3, max: 3 }),
  ],
};

// Testimonial Validators
export const testimonialValidators = {
  createRequest: [
    body("giverEmails")
      .isArray()
      .withMessage("Giver emails must be an array")
      .custom((emails) => {
        if (!emails.every((email) => /\S+@\S+\.\S+/.test(email))) {
          throw new Error("Invalid email(s) in giver list");
        }
        return true;
      }),
    commonValidators.string("projectDetails", { min: 10, max: 1000 }),
    body("additionalData").optional().isObject(),
  ],

  submitTestimonial: [
    commonValidators.string("testimonialText", { min: 10, max: 2000 }),
    body("rating").optional().isInt({ min: 1, max: 5 }),
    body("relationship").optional().isLength({ max: 100 }),
    body("skills").optional().isArray(),
    body("skills.*").optional().isString().isLength({ min: 1, max: 50 }),
  ],
};

// Testimonial Approval Validators
export const testimonialApprovalValidation = [
  param("testimonialId")
    .matches(REGEX.objectId)
    .withMessage("Invalid testimonial ID"),
  param("giverId").matches(REGEX.objectId).withMessage("Invalid giver ID"),
  body("comments")
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage("Comments cannot exceed 500 characters"),
];

// Testimonial Visibility Validators
export const testimonialVisibilityValidation = [
  param("testimonialId")
    .matches(REGEX.objectId)
    .withMessage("Invalid testimonial ID"),
  body("isPublic").isBoolean().withMessage("isPublic must be a boolean value"),
];

// Testimonial Sharing Validators
export const testimonialShareValidation = [
  param("testimonialId")
    .matches(REGEX.objectId)
    .withMessage("Invalid testimonial ID"),
  body("platform")
    .isIn(["email", "social"])
    .withMessage("Platform must be either email or social"),
  body("recipientEmail")
    .if(body("platform").equals("email"))
    .isEmail()
    .withMessage("Invalid recipient email address"),
];

// Search and Filter Validators
export const searchValidators = {
  pagination: [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("sortBy").optional().isIn(["createdAt", "rating", "relevance"]),
    query("order").optional().isIn(["asc", "desc"]),
  ],

  search: [
    query("q").optional().trim().isLength({ min: 2 }),
    query("type").optional().isIn(["testimonials", "users", "skills"]),
    query("dateRange").optional().isIn(["week", "month", "year", "all"]),
  ],
};

// Goal Validators
export const goalValidators = {
  createGoal: [
    commonValidators.string("title", { max: 100 }),
    commonValidators.string("description", { max: 500 }),
    body("deadline").isISO8601().withMessage("Invalid deadline date"),
    body("category").optional().isIn(["personal", "professional", "skill"]),
    body("priority").optional().isIn(["low", "medium", "high"]),
  ],

  updateGoal: [
    commonValidators.string("title", { required: false, max: 100 }),
    commonValidators.string("description", { required: false, max: 500 }),
    body("deadline").optional().isISO8601(),
    body("status").optional().isIn(["active", "completed", "cancelled"]),
    body("progress").optional().isInt({ min: 0, max: 100 }),
  ],
};

// Export validation middleware creator
export const createValidator = (validations) => {
  return async (req, res, next) => {
    try {
      await Promise.all(validations.map((validation) => validation.run(req)));
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError(
          errors
            .array()
            .map((err) => err.msg)
            .join(", "),
          400
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};

// Password Reset Data Validation
export const validatePasswordResetData = [
  body("email").trim().isEmail().withMessage("Invalid email format"),
  body("token").notEmpty().withMessage("Reset token is required"),
  body("newPassword")
    .matches(REGEX.password)
    .withMessage(
      "Password must contain uppercase, lowercase, number, and special character"
    ),
];

// Two Factor Authentication Validation
export const validateTwoFactorData = [
  body("code")
    .isString()
    .isLength({ min: 6, max: 6 })
    .withMessage("Invalid 2FA code"),
  body("userId").matches(REGEX.objectId).withMessage("Invalid user ID"),
];

// Update Data Validation
export const validateUpdateData = [
  body("id").matches(REGEX.objectId).withMessage("Invalid ID format"),
  body("status").optional().isIn(["active", "inactive", "pending"]),
  body("lastModified")
    .optional()
    .isISO8601()
    .withMessage("Invalid date format"),
  body("metadata")
    .optional()
    .isObject()
    .withMessage("Metadata must be an object"),
];

// Password Reset Validation
export const passwordResetValidation = {
  requestReset: [commonValidators.email("email")],

  verifyToken: [
    commonValidators.string("token"),
    commonValidators.email("email"),
  ],

  resetPassword: [
    body("newPassword")
      .matches(REGEX.password)
      .withMessage(
        "Password must contain uppercase, lowercase, number, and special character"
      ),
    body("confirmPassword").custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error("Passwords do not match");
      }
      return true;
    }),
    commonValidators.string("token"),
  ],
};

// Two Factor Authentication Validation Rules
export const twoFactorValidation = {
  setup: [
    commonValidators.string("phoneNumber", {
      regex: REGEX.phone,
      regexMessage: "Invalid phone number format",
    }),
    commonValidators
      .string("backupEmail", { required: false })
      .matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
      .withMessage("Invalid backup email format"),
  ],

  verify: [
    body("verificationCode")
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage("Verification code must be 6 digits"),
    commonValidators
      .enum("method", ["sms", "email", "authenticator"])
      .withMessage("Method must be either sms, email, or authenticator"),
  ],

  disable: [
    body("confirmationCode")
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage("Confirmation code must be 6 digits"),
    commonValidators.string("password"),
  ],
};

// Profile Update Validation Rules
export const updateProfileValidation = {
  basicInfo: [
    commonValidators.string("displayName", { max: 50, required: false }),
    commonValidators.string("headline", { max: 100, required: false }),
    body("avatar")
      .optional()
      .matches(REGEX.base64Image)
      .withMessage("Avatar must be a valid Base64 image string"),
    commonValidators
      .string("website", { required: false })
      .matches(REGEX.url)
      .withMessage("Website must be a valid URL"),
    body("skills").optional().isArray(),
    body("skills.*")
      .isString()
      .isLength({ min: 1, max: 30 })
      .withMessage("Each skill must be a string between 1 and 30 characters"),
  ],

  contact: [
    commonValidators
      .string("phone", { required: false })
      .matches(REGEX.phone)
      .withMessage("Invalid phone number format"),
    body("alternateEmail")
      .optional()
      .isEmail()
      .withMessage("Invalid alternate email address"),
    commonValidators.string("address", { max: 200, required: false }),
    commonValidators
      .enum("contactPreference", ["email", "phone", "both"], false)
      .withMessage("Contact preference must be either email, phone, or both"),
  ],

  social: [
    body("socialLinks").optional().isObject(),
    body("socialLinks.linkedin")
      .optional()
      .matches(REGEX.linkedinUrl)
      .withMessage("Invalid LinkedIn URL"),
    body("socialLinks.github")
      .optional()
      .matches(REGEX.githubUrl)
      .withMessage("Invalid GitHub URL"),
    body("socialLinks.twitter")
      .optional()
      .matches(REGEX.twitterUrl)
      .withMessage("Invalid Twitter URL"),
  ],
};

// Testimonial Request Validation using Joi
export const testimonialRequestValidation = (req, res, next) => {
  const schema = Joi.object({
    giverEmails: Joi.array().items(Joi.string().email()).min(1).required(),
    projectDetails: Joi.string().trim().required(),
    additionalData: Joi.object().optional(),
    templateId: Joi.string().optional(),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    throw new AppError(
      error.details.map((detail) => detail.message).join(", "),
      400
    );
  }
  next();
};

// Bulk Processing Validation using Joi
export const bulkProcessValidation = (req, res, next) => {
  const schema = Joi.object({
    testimonialIds: Joi.array()
      .items(Joi.string().hex().length(24))
      .min(1)
      .required(),
    action: Joi.string().valid("approve", "reject").required(),
    reason: Joi.string().trim().required(),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    throw new AppError(
      error.details.map((detail) => detail.message).join(", "),
      400
    );
  }
  next();
};

// Profile Picture Upload Validation
export const validateProfilePicture = (file) => {
  if (!file) {
    throw new AppError("No file uploaded", 400);
  }

  const allowedMimeTypes = ["image/jpeg", "image/png", "image/gif"];
  if (!allowedMimeTypes.includes(file.mimetype)) {
    throw new AppError(
      "Invalid file type. Only JPEG, PNG, and GIF are allowed.",
      400
    );
  }

  const maxSize = 2 * 1024 * 1024; // 2MB
  if (file.size > maxSize) {
    throw new AppError("File size exceeds the 2MB limit.", 400);
  }
};

// Archive and Restore Validation using Joi
export const archiveRestoreValidation = (req, res, next) => {
  const schema = Joi.object({
    testimonialId: Joi.string().hex().length(24).required(),
    action: Joi.string().valid("archive", "restore").required(),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    throw new AppError(
      error.details.map((detail) => detail.message).join(", "),
      400
    );
  }
  next();
};

// Certificate Generation Validation using Joi
export const certificateGenerationValidation = (req, res, next) => {
  const schema = Joi.object({
    testimonialId: Joi.string().hex().length(24).required(),
    templateId: Joi.string().hex().length(24).required(),
    recipientName: Joi.string().trim().max(100).required(),
    issueDate: Joi.date().iso().required(),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    throw new AppError(
      error.details.map((detail) => detail.message).join(", "),
      400
    );
  }
  next();
};

// Testimonial Report Validation using Joi
export const testimonialReportValidation = (req, res, next) => {
  const schema = Joi.object({
    testimonialId: Joi.string().hex().length(24).required(),
    reason: Joi.string().trim().max(500).required(),
    details: Joi.string().trim().max(2000).optional(),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    throw new AppError(
      error.details.map((detail) => detail.message).join(", "),
      400
    );
  }
  next();
};

// Chat Validators
export const chatValidation = {
  sendMessage: [
    commonValidators.string("messageText", { min: 1, max: 2000 }),
    body("recipientId")
      .matches(REGEX.objectId)
      .withMessage("Invalid recipient ID"),
  ],

  createChatRoom: [
    commonValidators.string("roomName", { min: 1, max: 100 }),
    body("participants")
      .isArray()
      .withMessage("Participants must be an array")
      .custom((participants) => {
        if (!participants.every((id) => REGEX.objectId.test(id))) {
          throw new Error("Invalid participant ID(s)");
        }
        return true;
      }),
  ],

  updateChatRoom: [
    commonValidators.string("roomName", { required: false, min: 1, max: 100 }),
    body("participants")
      .optional()
      .isArray()
      .withMessage("Participants must be an array")
      .custom((participants) => {
        if (!participants.every((id) => REGEX.objectId.test(id))) {
          throw new Error("Invalid participant ID(s)");
        }
        return true;
      }),
  ],
};

export const updatePreferencesValidation = [
  body("notifications").optional().isObject(),
  body("notifications.email").optional().isBoolean(),
  body("notifications.push").optional().isBoolean(),
  body("privacy.profileVisibility")
    .optional()
    .isIn(["public", "private", "connections"]),
  body("privacy.testimonialVisibility")
    .optional()
    .isIn(["public", "private", "connections"]),
  body("display.theme").optional().isIn(["light", "dark", "system"]),
  body("display.compactView").optional().isBoolean(),
];

export const updateSettingsValidation = [
  body("language").optional().isString().isLength({ min: 2, max: 5 }),
  body("timezone").optional().isString(),
  body("dateFormat")
    .optional()
    .isIn(["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]),
  body("timeFormat").optional().isIn(["12h", "24h"]),
  body("currency").optional().isString().isLength({ min: 3, max: 3 }),
];

export const validateTwoFactorSetup = [
  body("phoneNumber")
    .isString()
    .matches(REGEX.phone)
    .withMessage("Invalid phone number format"),
  body("backupEmail")
    .optional()
    .isEmail()
    .withMessage("Invalid backup email address"),
];

export const validateTwoFactorVerify = [
  body("verificationCode")
    .isString()
    .isLength({ min: 6, max: 6 })
    .withMessage("Verification code must be 6 digits"),
  body("method")
    .isString()
    .isIn(["sms", "email", "authenticator"])
    .withMessage("Method must be either sms, email, or authenticator"),
];

export const validateTwoFactorDisable = [
  body("confirmationCode")
    .isString()
    .isLength({ min: 6, max: 6 })
    .withMessage("Confirmation code must be 6 digits"),
  body("password").isString().withMessage("Password is required"),
];

export const validateProfileUpdate = [
  body("displayName").optional().isString().isLength({ min: 1, max: 50 }),
  body("headline").optional().isString().isLength({ min: 1, max: 100 }),
  body("avatar")
    .optional()
    .isString()
    .withMessage("Avatar must be a Base64 encoded image"),
  body("website").optional().isString().isURL(),
  body("skills").optional().isArray(),
  body("skills.*").optional().isString().isLength({ min: 1, max: 30 }),
];

export const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation Error",
      errors: errors.array(),
    });
  }
  next();
};

// Export all validators
export default {
  authValidators,
  profileValidators,
  testimonialValidators,
  testimonialApprovalValidation,
  testimonialVisibilityValidation,
  testimonialShareValidation,
  searchValidators,
  goalValidators,
  createValidator,
  validatePasswordResetData,
  validateTwoFactorData,
  validateUpdateData,
  passwordResetValidation,
  twoFactorValidation,
  updateProfileValidation,
  testimonialRequestValidation,
  bulkProcessValidation,
  validateProfilePicture,
  archiveRestoreValidation,
  certificateGenerationValidation,
  testimonialReportValidation,
  chatValidation,
};
