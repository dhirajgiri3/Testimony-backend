// src/middlewares/validate.js

import { validationResult } from "express-validator";
import { logger } from "../utils/logger.js";

export const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn("Validation errors:", errors.array());
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};