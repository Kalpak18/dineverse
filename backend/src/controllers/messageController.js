const db = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// ─── Owner: all conversations (orders with ≥1 message) ───────
exports.getConversations = asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT
       o.id            AS order_id,
       o.daily_order_number,
       o.order_type,
       o.customer_name,
       o.table_number,
       o.status,
       o.created_at    AS order_created_at,
       o.customer_msg_read_at,
       latest.message  AS last_message,
       latest.sender_type AS last_sender_type,
       latest.created_at  AS last_message_at,
       (SELECT COUNT(*)::int FROM order_messages WHERE order_id = o.id AND is_deleted = false) AS total_messages
     FROM orders o
     JOIN LATERAL (
       SELECT message, sender_type, created_at
       FROM order_messages
       WHERE order_id = o.id AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 1
     ) latest ON true
     WHERE o.cafe_id = $1
     ORDER BY latest.created_at DESC
     LIMIT 200`,
    [req.cafeId]
  );
  ok(res, { conversations: result.rows });
});

// ─── Helper: fetch messages for an order ─────────────────────
async function fetchMessages(orderId) {
  const result = await db.query(
    `SELECT id, sender_type, message, created_at, is_deleted
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
  const check = await db.query(
    `SELECT o.id FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND c.slug = $2`,
    [id, slug]
  );
  if (check.rows.length === 0) return fail(res, 'Order not found', 404);

  // Record that customer has read the chat — enables seen receipts for owner
  await db.query(
    `UPDATE orders SET customer_msg_read_at = NOW() WHERE id = $1`,
    [id]
  );

  ok(res, { messages: await fetchMessages(id) });
});

// ─── Public: customer posts a message ────────────────────────
exports.postCustomerMessage = asyncHandler(async (req, res) => {
  const { slug, id } = req.params;
  const { message } = req.body;
  if (!message?.trim()) return fail(res, 'Message cannot be empty');
  if (message.trim().length > 1000) return fail(res, 'Message too long');

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
     RETURNING id, sender_type, message, created_at, is_deleted`,
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
  const check = await db.query(
    'SELECT id, customer_msg_read_at FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, req.cafeId]
  );
  if (check.rows.length === 0) return fail(res, 'Order not found', 404);
  ok(res, {
    messages: await fetchMessages(id),
    customer_read_at: check.rows[0].customer_msg_read_at,
  });
});

// ─── Owner: post a message ────────────────────────────────────
exports.postOwnerMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  if (!message?.trim()) return fail(res, 'Message cannot be empty');
  if (message.trim().length > 1000) return fail(res, 'Message too long');

  const check = await db.query(
    'SELECT id FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, req.cafeId]
  );
  if (check.rows.length === 0) return fail(res, 'Order not found', 404);

  const result = await db.query(
    `INSERT INTO order_messages (order_id, cafe_id, sender_type, message)
     VALUES ($1, $2, 'owner', $3)
     RETURNING id, sender_type, message, created_at, is_deleted`,
    [id, req.cafeId, message.trim()]
  );
  const msg = result.rows[0];

  if (req.io) {
    req.io.to(`order:${id}`).emit('order_message', { order_id: id, ...msg });
    req.io.to(`cafe:${req.cafeId}`).emit('order_message', { order_id: id, ...msg });
  }

  ok(res, { message: msg }, 'Message sent', 201);
});

// ─── Owner: soft-delete their own message ────────────────────
exports.deleteOwnerMessage = asyncHandler(async (req, res) => {
  const { id, msgId } = req.params;

  const result = await db.query(
    `UPDATE order_messages
     SET is_deleted = true
     WHERE id = $1 AND order_id = $2 AND sender_type = 'owner'
       AND order_id IN (SELECT id FROM orders WHERE cafe_id = $3)
     RETURNING id`,
    [msgId, id, req.cafeId]
  );

  if (result.rows.length === 0) return fail(res, 'Message not found', 404);

  if (req.io) {
    req.io.to(`order:${id}`).emit('order_message_deleted', { order_id: id, msg_id: msgId });
  }

  ok(res, {}, 'Message deleted');
});
