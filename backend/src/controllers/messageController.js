const db = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// ─── Helper: fetch messages for an order ─────────────────────
async function fetchMessages(orderId) {
  const result = await db.query(
    `SELECT id, sender_type, message, created_at
     FROM order_messages
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [orderId]
  );
  return result.rows;
}

// ─── Public: customer gets messages ──────────────────────────
exports.getCustomerMessages = asyncHandler(async (req, res) => {
  const { slug, id } = req.params;
  // Verify order belongs to this slug
  const check = await db.query(
    `SELECT o.id FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND c.slug = $2`,
    [id, slug]
  );
  if (check.rows.length === 0) return fail(res, 'Order not found', 404);
  ok(res, { messages: await fetchMessages(id) });
});

// ─── Public: customer posts a message ────────────────────────
exports.postCustomerMessage = asyncHandler(async (req, res) => {
  const { slug, id } = req.params;
  const { message } = req.body;
  if (!message?.trim()) return fail(res, 'Message cannot be empty');
  if (message.trim().length > 1000) return fail(res, 'Message too long');

  // Verify order + get cafe_id
  const orderRes = await db.query(
    `SELECT o.id, o.cafe_id FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND c.slug = $2`,
    [id, slug]
  );
  if (orderRes.rows.length === 0) return fail(res, 'Order not found', 404);
  const { cafe_id } = orderRes.rows[0];

  const result = await db.query(
    `INSERT INTO order_messages (order_id, cafe_id, sender_type, message)
     VALUES ($1, $2, 'customer', $3)
     RETURNING id, sender_type, message, created_at`,
    [id, cafe_id, message.trim()]
  );
  const msg = result.rows[0];

  if (req.io) {
    req.io.to(`order:${id}`).emit('order_message', { order_id: id, ...msg });
    req.io.to(`cafe:${cafe_id}`).emit('order_message', { order_id: id, ...msg });
  }

  ok(res, { message: msg }, 'Message sent', 201);
});

// ─── Owner: get messages for an order ────────────────────────
exports.getOwnerMessages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  // Verify order belongs to this cafe
  const check = await db.query(
    'SELECT id FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, req.cafeId]
  );
  if (check.rows.length === 0) return fail(res, 'Order not found', 404);
  ok(res, { messages: await fetchMessages(id) });
});

// ─── Owner: post a message ────────────────────────────────────
exports.postOwnerMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  if (!message?.trim()) return fail(res, 'Message cannot be empty');
  if (message.trim().length > 1000) return fail(res, 'Message too long');

  // Verify order belongs to this cafe
  const check = await db.query(
    'SELECT id FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, req.cafeId]
  );
  if (check.rows.length === 0) return fail(res, 'Order not found', 404);

  const result = await db.query(
    `INSERT INTO order_messages (order_id, cafe_id, sender_type, message)
     VALUES ($1, $2, 'owner', $3)
     RETURNING id, sender_type, message, created_at`,
    [id, req.cafeId, message.trim()]
  );
  const msg = result.rows[0];

  if (req.io) {
    req.io.to(`order:${id}`).emit('order_message', { order_id: id, ...msg });
    req.io.to(`cafe:${req.cafeId}`).emit('order_message', { order_id: id, ...msg });
  }

  ok(res, { message: msg }, 'Message sent', 201);
});
