// Admin-controlled platform settings (platform_settings table), cached briefly
// because some are read on hot public paths. updateSetting() clears the cache
// so an admin change applies immediately.
const db = require('../config/database');
const cache = require('./cache');
const logger = require('./logger');

const TTL_MS = 30_000;
const cacheKey = (key) => `setting:${key}`;

async function getSetting(key, fallback = null) {
  const cached = await cache.get(cacheKey(key));
  if (cached) return cached.value;
  try {
    const { rows } = await db.query('SELECT value FROM platform_settings WHERE key = $1', [key]);
    const value = rows.length ? rows[0].value : fallback;
    await cache.set(cacheKey(key), { value }, TTL_MS);
    return value;
  } catch (err) {
    logger.warn('platform setting %s unavailable: %s', key, err.message);
    return fallback;
  }
}

const clearSetting = (key) => cache.del(cacheKey(key));

// Customers paying for food online (Razorpay Route). Off by default: customers
// pay at the counter and the café remits DineVerse's platform fee later.
async function onlineOrderPaymentsEnabled() {
  const v = await getSetting('online_order_payments', { enabled: false });
  return v?.enabled === true;
}

module.exports = { getSetting, clearSetting, onlineOrderPaymentsEnabled };
