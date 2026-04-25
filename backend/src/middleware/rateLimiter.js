const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

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
    tls: {},
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
  });
  client.on('error', () => {}); // suppress unhandled error events
  client.connect().catch(() => {}); // best-effort
  return new RedisStore({ sendCommand: (...args) => client.call(...args) });
}

const store = makeStore();

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function otpKeyGenerator(req) {
  const email = normalizeEmail(req.body?.email);
  return email ? `otp:${email}` : `otp-ip:${ipKeyGenerator(req.ip)}`;
}

// Strict limiter for login/register (brute-force protection)
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  store,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP sending: 5 sends per 5-minute window per email address.
// Keyed by email (not IP) so shared NATs don't block unrelated users.
// A separate per-email 60s cooldown is enforced in authController (otpStore.checkSendCooldown).
exports.otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  store,
  keyGenerator: otpKeyGenerator,
  skipFailedRequests: true,
  message: { success: false, message: 'Too many OTP requests. Please wait a few minutes before trying again.', error: 'Too many OTP requests. Please wait a few minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limiter
exports.apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  store,
  message: { success: false, message: 'Rate limit exceeded. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public order creation limiter — keyed by IP + café slug so limits are
// per-café, preventing one busy café from exhausting quota for others.
exports.orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  store,
  keyGenerator: (req) => `order:${ipKeyGenerator(req.ip)}:${req.params.slug || ''}`,
  message: { success: false, message: 'Too many orders placed. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check limiter: Render pings about every 30s, so 30/min is plenty.
// Prevents external actors from hammering /health to probe infrastructure state.
exports.healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  store,
  standardHeaders: true,
  legacyHeaders: false,
});
