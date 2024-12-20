import csrf from 'csurf';

// Configure CSRF protection middleware with secure defaults
const csrfProtection = csrf({
  cookie: {
    // Use secure cookies in production
    secure: process.env.NODE_ENV === 'production',
    // Restrict cookie to HTTP(S) only
    httpOnly: true,
    // Strict same-site policy
    sameSite: 'strict',
    // Set cookie path
    path: '/',
  },
  // Use double submit cookie pattern
  ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
  // Customize error handling
  value: (req) => {
    return req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
  },
});

// Wrapper to handle CSRF errors gracefully
const csrfMiddleware = (req, res, next) => {
  csrfProtection(req, res, (err) => {
    if (err) {
      return res.status(403).json({
        status: 'error',
        message: 'CSRF token validation failed',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
    next();
  });
};

export default csrfMiddleware;
