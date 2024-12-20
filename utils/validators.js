import { body, param, query } from 'express-validator';

/**
 * Validate MongoDB ObjectId
 * @param {string} field - Field name
 * @param {string} [location='param'] - Location of the field ('param' | 'query' | 'body')
 */
const objectId = (field, location = 'param') => {
  const validator =
    location === 'param' ? param : location === 'query' ? query : body;
  return [
    validator(field)
      .isMongoId()
      .withMessage(`${field} must be a valid MongoDB ObjectId`),
  ];
};

/**
 * Validate standard string
 * @param {string} field - Field name
 * @param {Object} [options={ min: 1, max: 100 }] - String length limits
 */
const string = (field, location = 'body', options = { min: 1, max: 100 }) => {
  const validator =
    location === 'param' ? param : location === 'query' ? query : body;
  return [
    validator(field)
      .optional()
      .isString()
      .withMessage(`${field} must be a string`)
      .isLength(options)
      .withMessage(
        `${field} must be between ${options.min} and ${options.max} characters`
      ),
  ];
};

/**
 * Validate integer
 * @param {string} field - Field name
 * @param {Object} [options={}] - Integer constraints
 */
const integer = (field, options = {}) => {
  return [
    body(field)
      .optional()
      .isInt(options)
      .withMessage(
        `${field} must be an integer${options.min ? ` >= ${options.min}` : ''}${
          options.max ? ` <= ${options.max}` : ''
        }`
      ),
  ];
};

/**
 * Validate email
 * @param {string} field - Field name
 */
const email = (field) => {
  return [
    body(field)
      .optional()
      .isEmail()
      .withMessage(`${field} must be a valid email`),
  ];
};

/**
 * Validate boolean
 * @param {string} field - Field name
 */
const boolean = (field) => {
  return [
    body(field)
      .optional()
      .isBoolean()
      .withMessage(`${field} must be true or false`),
  ];
};

const validators = {
  objectId,
  string,
  integer,
  email,
  boolean,
};

export default validators;
