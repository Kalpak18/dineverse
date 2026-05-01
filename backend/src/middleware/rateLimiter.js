const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Shared Redis client — one connection, reused across all store instances.
// express-rate-limit v7 requires a SEPARATE RedisStore instance per limiter
// (each with a unique prefix), but they can all share the same Redis connection.
let _redisClient = null;

function getRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (_redisClient) return _redisClient;

  const Redis = require('ioredis');
  _redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    tls: {},
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
  });
  _redisClient.on('error', () => {});
  _redisClient.connect().catch(() => {});
  return _redisClient;
}

// Create a fresh RedisStore instance for each limiter (unique prefix required).
// Falls back to undefined (in-memory) when REDIS_URL is not set.
function makeStore(prefix) {
  const client = getRedisClient();
  if (!client) return undefined;

  const { RedisStore } = require('rate-limit-redis');
  return new RedisStore({ sendCommand: (...args) => client.call(...args), prefix });
}

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
  store: makeStore('rl:auth:'),
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
  store: makeStore('rl:otp:'),
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
  store: makeStore('rl:api:'),
  message: { success: false, message: 'Rate limit exceeded. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public order creation limiter — keyed by IP + café slug so limits are
// per-café, preventing one busy café from exhausting quota for others.
exports.orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  store: makeStore('rl:order:'),
  keyGenerator: (req) => `order:${ipKeyGenerator(req.ip)}:${req.params.slug || ''}`,
  message: { success: false, message: 'Too many orders placed. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public action limiter — cancel, payment, customer chat: 10 req/min per IP.
// Prevents order-cancel floods, payment-endpoint probing, and chat spam.
exports.publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  store: makeStore('rl:pub:'),
  message: { success: false, message: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check limiter: Render pings about every 30s, so 30/min is plenty.
// Prevents external actors from hammering /health to probe infrastructure state.
exports.healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  store: makeStore('rl:health:'),
  standardHeaders: true,
  legacyHeaders: false,
});
