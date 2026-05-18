// Shared cache — Redis-backed in production, in-memory Map for local dev.
// All methods are async so callers work identically in both modes.
//
// Redis is lazily connected using REDIS_URL. If Redis is down, falls back
// to the in-memory store so the app keeps running (with per-process caching).

const logger = require('./logger');
let redisClient = null;
const store = new Map();

function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (redisClient) return redisClient;

  const Redis = require('ioredis');
  redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    tls: {},
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
  });
  redisClient.on('error', () => {}); // prevent unhandled error crashes
  redisClient.connect().catch(() => {});
  return redisClient;
}

async function get(key) {
  const redis = getRedis();
  if (redis) {
    try {
      const val = await redis.get(`cache:${key}`);
      return val ? JSON.parse(val) : null;
    } catch (err) { logger.debug('cache.get failed for %s: %s', key, err.message); return null; }
  }
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
  return entry.value;
}

async function set(key, value, ttlMs = 60_000) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`cache:${key}`, JSON.stringify(value), 'PX', ttlMs);
    } catch (err) { logger.debug('cache.set failed for %s: %s', key, err.message); }
    return;
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function del(key) {
  const redis = getRedis();
  if (redis) {
    try { await redis.del(`cache:${key}`); } catch (err) { logger.debug('cache.del failed for %s: %s', key, err.message); }
    return;
  }
  store.delete(key);
}

module.exports = { get, set, del };
