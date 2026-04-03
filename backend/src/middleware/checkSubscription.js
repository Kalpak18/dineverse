const db = require('../config/database');
const logger = require('../utils/logger');

const WARN_DAYS = 7; // Show warning this many days before expiry

module.exports = async function checkSubscription(req, res, next) {
  try {
    // Outlets share the parent (root) café's subscription
    const result = await db.query(
      'SELECT plan_type, plan_expiry_date FROM cafes WHERE id = $1',
      [req.rootCafeId || req.cafeId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Café not found' });
    }

    const { plan_type, plan_expiry_date } = result.rows[0];

    if (plan_expiry_date) {
      const now = new Date();
      const expiry = new Date(plan_expiry_date);

      if (expiry < now) {
        return res.status(403).json({
          success: false,
          message: 'Your subscription has expired. Please renew to continue using DineVerse.',
          error: 'subscription_expired',
          expiry_date: plan_expiry_date,
        });
      }

      const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
      req.subscriptionDaysLeft = daysLeft <= WARN_DAYS ? daysLeft : null;
    }

    req.subscription = { plan_type, plan_expiry_date };
    next();
  } catch (err) {
    logger.error('CheckSubscription DB error: %s', err.message);
    return res.status(503).json({
      success: false,
      message: 'Service temporarily unavailable. Please try again.',
      error: 'subscription_check_failed',
    });
  }
};
