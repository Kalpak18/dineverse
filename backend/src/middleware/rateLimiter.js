const rateLimit = require('express-rate-limit');

// Use Redis store when REDIS_URL is set (multi-instance production).
// Falls back to in-memory store for local dev / single-instance Phase 1.
function makeStore() {
  if (!process.env.REDIS_URL) return undefined; // default in-memory

  const { RedisStore } = require('rate-limit-redis');
  const Redis = require('ioredis');
  const client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  client.connect().catch(() => {}); // best-effort
  return new RedisStore({ sendCommand: (...args) => client.call(...args) });
}

const store = makeStore();

// Strict limiter for login/register (brute-force protection)
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  store,
  message: { success: false, message: 'Too many attempts — please try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Very strict limiter for OTP sending (prevent email spam)
exports.otpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  store,
  message: { success: false, message: 'Too many OTP requests — wait a minute before trying again' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limiter
exports.apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  store,
  message: { success: false, message: 'Rate limit exceeded — slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public order creation limiter
exports.orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  store,
  message: { success: false, message: 'Too many orders placed — please wait a moment' },
  standardHeaders: true,
  legacyHeaders: false,
});

// AI menu import — each call costs money; 10 per hour per café
exports.aiImportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  store,
  keyGenerator: (req) => req.cafeId || req.ip,
  message: { success: false, message: 'AI import limit reached — try again in an hour' },
  standardHeaders: true,
  legacyHeaders: false,
});
