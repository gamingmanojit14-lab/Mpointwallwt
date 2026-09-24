/**
 * Rate limiters:
 *  - globalLimiter : 100 req/min per IP across /api/*
 *  - authFailLimiter : per-IP brute-force lock (5 failures in 15 min → block)
 */
const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Try again later.' },
});

// separate limiter that only counts failures via skipSuccessfulRequests
const authFailLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_LOCK_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.AUTH_MAX_FAILURES || 5),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}:auth`,
  message: {
    success: false,
    error: 'Too many failed authentication attempts. Try again later.',
  },
});

module.exports = { globalLimiter, authFailLimiter };
