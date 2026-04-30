const webpush = require('web-push');
const db = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

// VAPID keys must be set in env. Generate once with:
//   node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(k);"
// Then set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in .env
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@dine-verse.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Public: return VAPID public key so clients can subscribe
exports.getVapidKey = (_req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ success: false, message: 'Push notifications not configured' });
  }
  ok(res, { vapidPublicKey: process.env.VAPID_PUBLIC_KEY });
};

// Authenticated: save push subscription for this café/user
exports.subscribe = asyncHandler(async (req, res) => {
  const { subscription, subscriber_type = 'owner' } = req.body;
  if (!subscription?.endpoint) return fail(res, 'Invalid subscription object');

  await db.query(
    `INSERT INTO push_subscriptions (cafe_id, endpoint, p256dh, auth, subscriber_type)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh,
           auth   = EXCLUDED.auth,
           cafe_id = EXCLUDED.cafe_id,
           subscriber_type = EXCLUDED.subscriber_type,
           updated_at = NOW()`,
    [
      req.cafeId,
      subscription.endpoint,
      subscription.keys?.p256dh,
      subscription.keys?.auth,
      subscriber_type,
    ]
  );
  ok(res, {}, 'Subscribed to push notifications');
});

// Authenticated: remove subscription (unsubscribe / browser unregistered)
exports.unsubscribe = asyncHandler(async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return fail(res, 'endpoint required');
  await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND cafe_id = $2', [endpoint, req.cafeId]);
  ok(res, {}, 'Unsubscribed');
});

// Internal helper: send push to all owner subscriptions for a café
exports.sendToOwners = async (cafeId, payload) => {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    const result = await db.query(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions
       WHERE cafe_id = $1 AND subscriber_type = 'owner'`,
      [cafeId]
    );
    const sends = result.rows.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload)
      ).catch(async (err) => {
        // 410 Gone = subscription expired; clean it up
        if (err.statusCode === 410) {
          await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [row.endpoint]);
        } else {
          logger.warn('Push send failed: %s', err.message);
        }
      })
    );
    await Promise.all(sends);
  } catch (err) {
    logger.warn('sendToOwners failed: %s', err.message);
  }
};
