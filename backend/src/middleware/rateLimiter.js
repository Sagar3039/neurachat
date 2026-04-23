import rateLimit from 'express-rate-limit';

/**
 * Per-user rate limiter: 10 requests per minute.
 * Uses verified uid from req.user (set by requireAuth middleware).
 * Must be applied AFTER requireAuth.
 */
export const userRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,

  // Key by authenticated uid — not IP — to prevent cross-user limit sharing
  keyGenerator: (req) => {
    if (!req.user?.uid) {
      // Should never happen if requireAuth runs first, but fail safe
      return req.ip;
    }
    return req.user.uid;
  },

  handler: (req, res) => {
    console.warn(`[RateLimit] User ${req.user?.uid} exceeded rate limit`);
    return res.status(429).json({
      error: 'TooManyRequests',
      message: 'Too many requests, please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
    });
  },

  skip: (req) => {
    // Don't skip anything — all authenticated users are subject to limits
    return false;
  },
});
