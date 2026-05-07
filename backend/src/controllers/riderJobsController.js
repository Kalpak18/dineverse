/**
 * Rider job management.
 *
 * Endpoints (all require requireRider middleware):
 *   GET    /api/rider/jobs            → list of orders currently assigned to me
 *   GET    /api/rider/jobs/:id        → single job detail
 *   PATCH  /api/rider/jobs/:id/status → advance delivery_status
 *   PATCH  /api/rider/location        → broadcast my live GPS to all active jobs
 *
 * Only orders for cafés with delivery_enabled=true are returned (defence in
 * depth — requireRider also checks this on the cafe directly).
 */

const db   = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

// Allowed delivery_status transitions a rider can drive
const TRANSITIONS = {
  assigned:        ['picked_up', 'failed'],
  picked_up:       ['out_for_delivery', 'failed'],
  out_for_delivery:['delivered', 'failed'],
  // delivered/failed are terminal — owner must reopen if needed
  delivered:       [],
  failed:          [],
};

const ACTIVE_STATES = ['assigned', 'picked_up', 'out_for_delivery'];

// ─── GET /api/rider/jobs ──────────────────────────────────────
exports.getMyJobs = asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT o.id,
            COALESCE(o.daily_order_number, o.order_number) AS order_number,
            o.customer_name, o.delivery_phone, o.delivery_address, o.delivery_address2,
            o.delivery_city, o.delivery_zipcode, o.delivery_lat, o.delivery_lng,
            o.delivery_instructions, o.delivery_status, o.delivery_fee,
            o.final_amount, o.payment_verified, o.payment_mode,
            o.notes, o.created_at, o.delivered_at,
            c.name        AS cafe_name,
            c.address     AS cafe_address,
            c.phone       AS cafe_phone,
            c.latitude    AS cafe_lat,
            c.longitude   AS cafe_lng,
            (SELECT json_agg(json_build_object(
                'name', oi.item_name,
                'quantity', oi.quantity
              ) ORDER BY oi.id)
             FROM order_items oi WHERE oi.order_id = o.id) AS items
     FROM orders o
     JOIN cafes c ON c.id = o.cafe_id
     WHERE o.cafe_id = $1
       AND o.rider_id = $2
       AND o.order_type = 'delivery'
       AND o.delivery_status = ANY($3)
       AND c.delivery_enabled = true
     ORDER BY o.created_at ASC`,
    [req.cafeId, req.riderId, ACTIVE_STATES]
  );
  ok(res, { jobs: result.rows });
});

// ─── GET /api/rider/jobs/:id ──────────────────────────────────
exports.getJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    `SELECT o.*,
            c.name AS cafe_name, c.address AS cafe_address, c.phone AS cafe_phone,
            c.latitude AS cafe_lat, c.longitude AS cafe_lng,
            (SELECT json_agg(json_build_object(
                'name', oi.item_name,
                'quantity', oi.quantity,
                'subtotal', oi.subtotal
              ) ORDER BY oi.id)
             FROM order_items oi WHERE oi.order_id = o.id) AS items
     FROM orders o
     JOIN cafes c ON c.id = o.cafe_id
     WHERE o.id = $1 AND o.cafe_id = $2 AND o.rider_id = $3`,
    [id, req.cafeId, req.riderId]
  );
  if (!result.rows.length) return fail(res, 'Job not found', 404);
  ok(res, { job: result.rows[0] });
});

// ─── PATCH /api/rider/jobs/:id/status ─────────────────────────
exports.updateJobStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, failure_reason } = req.body;

  if (!Object.keys(TRANSITIONS).includes(status)) {
    return fail(res, 'Invalid delivery status', 400);
  }

  const cur = await db.query(
    `SELECT id, delivery_status FROM orders
     WHERE id = $1 AND cafe_id = $2 AND rider_id = $3`,
    [id, req.cafeId, req.riderId]
  );
  if (!cur.rows.length) return fail(res, 'Job not found or not assigned to you', 404);

  const currentStatus = cur.rows[0].delivery_status || 'assigned';
  if (!TRANSITIONS[currentStatus]?.includes(status)) {
    return fail(res, `Cannot move job from "${currentStatus}" to "${status}"`, 409);
  }

  // Stamp delivered_at when terminal
  const stamp = status === 'delivered' ? 'delivered_at = NOW(),' : '';
  const reason = status === 'failed' ? (failure_reason || 'Failed') : null;

  await db.query(
    `UPDATE orders SET
       delivery_status = $1,
       ${stamp}
       delivery_failed_reason = COALESCE($2, delivery_failed_reason),
       updated_at = NOW()
     WHERE id = $3`,
    [status, reason, id]
  );

  // Broadcast to customer + cafe rooms
  const payload = { order_id: id, delivery_status: status };
  req.io?.to(`order:${id}`).emit('delivery_updated', payload);
  req.io?.to(`cafe:${req.cafeId}`).emit('order_updated', { id, delivery_status: status });

  logger.info('Rider %s advanced order %s: %s → %s', req.riderId, id, currentStatus, status);
  ok(res, { delivery_status: status });
});

// ─── PATCH /api/rider/location ────────────────────────────────
// Single GPS endpoint that updates all of rider's active orders at once.
// Frontend pings this every 10s while location sharing is on.
exports.pingLocation = asyncHandler(async (req, res) => {
  const lat = parseFloat(req.body?.lat);
  const lng = parseFloat(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fail(res, 'lat and lng required', 400);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return fail(res, 'Invalid coordinates', 400);
  }

  const updated = await db.query(
    `UPDATE orders SET
       driver_lat = $1, driver_lng = $2, driver_updated_at = NOW()
     WHERE cafe_id = $3 AND rider_id = $4
       AND order_type = 'delivery'
       AND delivery_status = ANY($5)
     RETURNING id`,
    [lat, lng, req.cafeId, req.riderId, ACTIVE_STATES]
  );

  // Broadcast to each customer's order room
  for (const row of updated.rows) {
    req.io?.to(`order:${row.id}`).emit('driver_location', { order_id: row.id, lat, lng });
  }

  // Update last_seen so the owner can see the rider is online
  db.query('UPDATE cafe_riders SET last_seen_at = NOW() WHERE id = $1', [req.riderId]).catch(() => {});

  ok(res, { updated: updated.rows.length });
});
