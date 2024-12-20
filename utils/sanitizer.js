// src/utils/sanitizer.js

import sanitizeHtml from 'sanitize-html';

export const sanitizeInput = (input) => {
  return sanitizeHtml(input, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
  });
};
