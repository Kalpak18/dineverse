/**
 * deliveryWebhookController.js
 *
 * Handles inbound status callbacks from an external delivery partner and
 * provides an internal endpoint to dispatch a delivery request outbound.
 *
 * Security: each webhook POST is HMAC-verified using a shared secret stored
 * in the DELIVERY_WEBHOOK_SECRET env variable.
 */
const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../utils/logger');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const { notify } = require('../services/notificationService');

// ─── HMAC verification middleware ─────────────────────────────
exports.verifyWebhookSignature = (req, res, next) => {
  const secret = process.env.DELIVERY_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return fail(res, 'Webhook not configured', 503);
    }
    logger.warn('DELIVERY_WEBHOOK_SECRET not set — skipping signature verification (dev only)');
    return next();
  }

  const signature = req.headers['x-delivery-signature'];
  if (!signature) return fail(res, 'Missing webhook signature', 401);

  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    logger.warn('Invalid delivery webhook signature');
    return fail(res, 'Invalid signature', 401);
  }
  next();
};

// ─── POST /api/delivery/webhook ───────────────────────────────
// Receives status updates from the external delivery partner.
// Payload: { partner_order_id, order_ref, status, driver?, delivered_at?, failure_reason? }
exports.receiveWebhook = asyncHandler(async (req, res) => {
  const {
    partner_order_id,
    order_ref,        // DineVerse order UUID
    status,
    driver = {},
    delivered_at,
    failure_reason,
  } = req.body;

  const validStatuses = ['pending', 'assigned', 'picked_up', 'out_for_delivery', 'delivered', 'failed'];
  if (!validStatuses.includes(status)) {
    return fail(res, `Unknown delivery status: ${status}`, 400);
  }
  if (!order_ref) return fail(res, 'order_ref is required', 400);

  // Look up the order and its café
  const orderResult = await db.query(
    `SELECT o.id, o.cafe_id, c.email AS cafe_email, c.name AS cafe_name,
            o.customer_name, o.order_type, o.delivery_status
     FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND o.order_type = 'delivery'`,
    [order_ref]
  );

  if (orderResult.rows.length === 0) {
    logger.warn('Delivery webhook: order not found or not a delivery order: %s', order_ref);
    return fail(res, 'Order not found', 404);
  }

  const order = orderResult.rows[0];

  // Build UPDATE
  const updated = await db.query(
    `UPDATE orders
     SET delivery_status            = $1,
         delivery_partner_order_id  = COALESCE($2, delivery_partner_order_id),
         driver_name                = COALESCE($3, driver_name),
         driver_phone               = COALESCE($4, driver_phone),
         driver_lat                 = COALESCE($5, driver_lat),
         driver_lng                 = COALESCE($6, driver_lng),
         delivered_at               = CASE WHEN $1 = 'delivered' THEN COALESCE($7::timestamptz, NOW()) ELSE delivered_at END,
         delivery_failed_reason     = COALESCE($8, delivery_failed_reason),
         updated_at                 = NOW()
     WHERE id = $9
     RETURNING id, delivery_status, driver_name, driver_phone, driver_lat, driver_lng, delivered_at`,
    [
      status,
      partner_order_id || null,
      driver.name || null,
      driver.phone || null,
      driver.lat != null ? parseFloat(driver.lat) : null,
      driver.lng != null ? parseFloat(driver.lng) : null,
      delivered_at || null,
      failure_reason || null,
      order.id,
    ]
  );

  const updatedOrder = updated.rows[0];

  // Broadcast to customer tracking screen
  if (req.io) {
    req.io.to(`order:${order.id}`).emit('delivery_updated', {
      order_id:        order.id,
      delivery_status: status,
      driver_name:     updatedOrder.driver_name,
      driver_phone:    updatedOrder.driver_phone,
      driver_lat:      updatedOrder.driver_lat,
      driver_lng:      updatedOrder.driver_lng,
      delivered_at:    updatedOrder.delivered_at,
    });
  }

  // Notify owner
  const statusLabels = {
    assigned:         'Driver assigned',
    picked_up:        'Order picked up',
    out_for_delivery: 'Out for delivery',
    delivered:        'Order delivered',
    failed:           'Delivery failed',
  };
  const label = statusLabels[status];
  if (label) {
    notify(req.io, order.cafe_id, order.cafe_email, {
      type:  'new_order',
      title: `${label} — ${order.customer_name}`,
      body:  status === 'failed' ? (failure_reason || 'Delivery could not be completed') : '',
      refId: order.id,
      email: false,
    }).catch(() => {});
  }

  logger.info('Delivery webhook: order %s → %s', order.id, status);
  ok(res, { order_id: order.id, delivery_status: status }, 'Status updated');
});

// ─── POST /api/delivery/partner/request ───────────────────────
// Internal call: owner triggers a delivery dispatch for an existing order.
// In a real integration this would call the external delivery partner's API.
exports.requestDelivery = asyncHandler(async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return fail(res, 'order_id is required', 400);

  const orderResult = await db.query(
    `SELECT o.id, o.cafe_id, o.order_type, o.delivery_status,
            o.delivery_address, o.delivery_phone, o.delivery_lat, o.delivery_lng,
            o.customer_name, o.final_amount,
            c.latitude AS cafe_lat, c.longitude AS cafe_lng,
            c.address AS cafe_address, c.phone AS cafe_phone
     FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND o.cafe_id = $2 AND o.order_type = 'delivery'`,
    [order_id, req.cafeId]
  );

  if (orderResult.rows.length === 0) return fail(res, 'Delivery order not found', 404);
  const order = orderResult.rows[0];

  if (order.delivery_status && order.delivery_status !== 'pending') {
    return fail(res, 'Delivery already in progress or completed', 409);
  }

  // TODO: When an external delivery partner is integrated, call their API here.
  // For now, mark the order as "pending" dispatch and return the dispatch payload.
  const dispatchPayload = {
    pickup: {
      lat:     order.cafe_lat,
      lng:     order.cafe_lng,
      address: order.cafe_address,
      contact: order.cafe_phone,
    },
    dropoff: {
      lat:     order.delivery_lat,
      lng:     order.delivery_lng,
      address: order.delivery_address,
      contact: order.delivery_phone,
    },
    order_ref:         order.id,
    customer_name:     order.customer_name,
    cod_amount:        0,  // Razorpay handles payment; no COD
  };

  logger.info('Delivery dispatch requested for order %s', order.id);
  ok(res, { dispatch: dispatchPayload, message: 'Delivery partner integration pending — dispatch payload ready' });
});
