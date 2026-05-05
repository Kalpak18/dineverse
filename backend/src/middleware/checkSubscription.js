// Commission-based model: all features are available to every café.
// This middleware is kept as a no-op pass-through so existing route imports
// don't break. It attaches commission_rate to req for downstream use.
const db = require('../config/database');
const logger = require('../utils/logger');

module.exports = async function checkSubscription(req, res, next) {
  try {
    const result = await db.query(
      'SELECT commission_rate FROM cafes WHERE id = $1',
      [req.rootCafeId || req.cafeId]
    );
    req.commissionRate = result.rows[0]?.commission_rate ?? 5;
    req.subscription = { plan_type: 'active', plan_tier: 'premium' }; // treat all as premium
  } catch (err) {
    logger.warn('checkSubscription (commission lookup) failed: %s', err.message);
    req.commissionRate = 5;
    req.subscription = { plan_type: 'active', plan_tier: 'premium' };
  }
  next();
};
