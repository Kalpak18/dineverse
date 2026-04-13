const db = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/notifications — last 50 unread (or all recent) for this café
exports.getNotifications = asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT id, type, title, body, ref_id, is_read, created_at
     FROM notifications
     WHERE cafe_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.cafeId]
  );
  const unread = result.rows.filter((n) => !n.is_read).length;
  ok(res, { notifications: result.rows, unread_count: unread });
});

// PATCH /api/notifications/read-all — mark all as read
exports.markAllRead = asyncHandler(async (req, res) => {
  await db.query(
    'UPDATE notifications SET is_read = true WHERE cafe_id = $1 AND is_read = false',
    [req.cafeId]
  );
  ok(res, { marked: true });
});

// PATCH /api/notifications/:id/read — mark single notification as read
exports.markRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    'UPDATE notifications SET is_read = true WHERE id = $1 AND cafe_id = $2 RETURNING id',
    [id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Notification not found', 404);
  ok(res, { marked: true });
});

// DELETE /api/notifications — clear all for this café
exports.clearAll = asyncHandler(async (req, res) => {
  await db.query('DELETE FROM notifications WHERE cafe_id = $1', [req.cafeId]);
  ok(res, { cleared: true });
});
