// src/middlewares/sanitize.js

import { sanitizeInput } from "../utils/sanitizer.js";

export const sanitizeBody = (req, res, next) => {
  if (req.body) {
    for (let key in req.body) {
      if (typeof req.body[key] === "string") {
        req.body[key] = sanitizeInput(req.body[key]);
      }
    }
  }
  next();
};