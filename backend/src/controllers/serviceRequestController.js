const db = require('../config/database');
const logger = require('../utils/logger');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const { hasOrderToken } = require('../utils/orderToken');
const { notify } = require('../services/notificationService');

// Same request again within this window is "already on the way" (anti-spam)
const COOLDOWN_MS = 2 * 60 * 1000;
const LABEL = { waiter: 'is calling a waiter', bill: 'asked for the bill' };

const publicRequest = (r) => ({
  id: r.id, order_id: r.order_id, type: r.type, status: r.status,
  table_number: r.table_number, table_verified: r.table_verified,
  created_at: r.created_at, acknowledged_at: r.acknowledged_at,
});

// ─── Customer: POST /orders/cafe/:slug/orders/:id/service-request ─────
// Needs the order's secret (X-Order-Token) — only the customer who placed an
// open dine-in order can ring their table's bell.
exports.createServiceRequest = asyncHandler(async (req, res) => {
  const { slug, id } = req.params;
  const { type } = req.body;
  if (!['waiter', 'bill'].includes(type)) return fail(res, 'type must be waiter or bill', 400);

  const o = await db.query(
    `SELECT o.id, o.cafe_id, o.table_number, o.table_verified, o.order_type, o.status, o.customer_token, c.email
     FROM orders o JOIN cafes c ON c.id = o.cafe_id
     WHERE o.id = $1 AND c.slug = $2`,
    [id, slug]
  );
  const order = o.rows[0];
  if (!order || !hasOrderToken(req, order.customer_token)) return fail(res, 'Order not found', 404);
  if (['takeaway', 'delivery'].includes(order.order_type)) return fail(res, 'Only for dine-in orders', 400);
  if (['paid', 'cancelled'].includes(order.status)) return fail(res, 'This order is already closed', 400);

  // One open request per type per order; a repeat tap returns the open one
  const recent = await db.query(
    `SELECT * FROM service_requests
     WHERE order_id = $1 AND type = $2 AND (status = 'open' OR created_at > NOW() - ($3 || ' milliseconds')::interval)
     ORDER BY created_at DESC LIMIT 1`,
    [id, type, String(COOLDOWN_MS)]
  );
  if (recent.rows.length) return ok(res, { request: publicRequest(recent.rows[0]), repeat: true });

  const r = await db.query(
    `INSERT INTO service_requests (cafe_id, order_id, table_number, table_verified, type)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [order.cafe_id, id, order.table_number, order.table_verified, type]
  );
  const request = publicRequest(r.rows[0]);
  req.io?.to(`cafe:${order.cafe_id}`).emit('service_request', request);
  const where = order.table_verified ? order.table_number : `${order.table_number} (table not confirmed)`;
  notify(req.io, order.cafe_id, order.email, {
    type: type === 'bill' ? 'service_bill' : 'service_waiter',
    title: `${where} ${LABEL[type]}`,
    refId: id,
  }).catch(() => {});
  logger.info('Service request %s: %s for order %s', type, where, id);
  ok(res, { request }, type === 'bill' ? 'Bill requested' : 'Waiter called', 201);
});

// ─── Staff: GET /orders/service-requests ──────────────────────
exports.getServiceRequests = asyncHandler(async (req, res) => {
  const r = await db.query(
    `SELECT * FROM service_requests
     WHERE cafe_id = $1 AND status = 'open' AND created_at > NOW() - interval '12 hours'
     ORDER BY created_at ASC`,
    [req.cafeId]
  );
  ok(res, { requests: r.rows.map(publicRequest) });
});

// ─── Staff: PATCH /orders/service-requests/:rid/ack ───────────
exports.acknowledgeServiceRequest = asyncHandler(async (req, res) => {
  const r = await db.query(
    `UPDATE service_requests
     SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $3
     WHERE id = $1 AND cafe_id = $2 AND status = 'open'
     RETURNING *`,
    [req.params.rid, req.cafeId, req.staffId || req.cafeId]
  );
  if (!r.rows.length) return fail(res, 'Request not found or already handled', 404);
  const request = publicRequest(r.rows[0]);
  req.io?.to(`cafe:${req.cafeId}`).emit('service_request_updated', request);
  if (request.order_id) req.io?.to(`order:${request.order_id}`).emit('service_request_updated', request);
  ok(res, { request });
});
