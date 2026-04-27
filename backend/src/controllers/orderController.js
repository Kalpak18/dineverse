const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('../config/database');
const logger = require('../utils/logger');
const { ok, fail, validationFail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const { applyBestOffer } = require('./offerController');
const { notify } = require('../services/notificationService');

// ─── Schedule helper ────────────────────────────────────────────
// Returns null (open) or a string reason why orders are blocked.
// opening_hours is the JSONB value from DB; tz is IANA timezone string.
function scheduleBlock(opening_hours, tz) {
  if (!opening_hours) return null; // no schedule set — rely on is_open toggle only

  // Convert UTC now to café local time using Intl
  const localStr = new Date().toLocaleString('en-CA', { timeZone: tz || 'Asia/Kolkata', hour12: false });
  // en-CA gives "YYYY-MM-DD, HH:MM:SS"
  const [, timePart] = localStr.split(', ');
  const [hh, mm] = timePart.split(':').map(Number);
  const nowMins = hh * 60 + mm;

  const dayIndex = new Date().toLocaleDateString('en-US', { timeZone: tz || 'Asia/Kolkata', weekday: 'short' });
  // 'Sun', 'Mon' … → lowercase 3-letter
  const dayKey = dayIndex.slice(0, 3).toLowerCase();
  const daySchedule = opening_hours[dayKey];

  if (!daySchedule) return null; // day not configured — allow
  if (daySchedule.closed) return `Closed today — no orders accepted`;

  const [oh, om] = (daySchedule.open  || '00:00').split(':').map(Number);
  const [ch, cm] = (daySchedule.close || '23:59').split(':').map(Number);
  const openMins  = oh * 60 + om;
  const closeMins = ch * 60 + cm;

  if (nowMins < openMins) {
    const opensAt = daySchedule.open;
    return `Café not open yet — opens at ${opensAt}`;
  }
  if (nowMins >= closeMins) {
    const closedAt = daySchedule.close;
    return `Café is closed for the day — closed at ${closedAt}`;
  }
  return null; // within open window
}

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID     || process.env.RAZORPAY_TEST_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET,
});

// ─── Public: Customer places an order ─────────────────────────
// Haversine distance in km between two lat/lng points
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

exports.validateOrder = [
  body('customer_name').trim().notEmpty().withMessage('Your name is required'),
  body('order_type')
    .optional()
    .isIn(['dine-in', 'takeaway', 'delivery']).withMessage('order_type must be dine-in, takeaway, or delivery'),
  body('table_number')
    .if(body('order_type').not().equals('takeaway'))
    .if(body('order_type').not().equals('delivery'))
    .trim().notEmpty().withMessage('Table number is required for dine-in orders'),
  body('customer_phone').optional().trim().isLength({ max: 20 }),
  body('client_order_id').optional().trim().isLength({ max: 64 }),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.menu_item_id').notEmpty().withMessage('menu_item_id is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('delivery_address')
    .if(body('order_type').equals('delivery'))
    .trim().notEmpty().withMessage('Delivery address is required'),
  body('delivery_phone')
    .if(body('order_type').equals('delivery'))
    .trim().notEmpty().withMessage('Phone number is required for delivery'),
];

exports.createOrder = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { slug } = req.params;
  const {
    customer_name, customer_phone, table_number, items, notes,
    order_type = 'dine-in', client_order_id, tip_amount = 0,
    // delivery fields
    delivery_address, delivery_address2, delivery_city, delivery_zipcode,
    delivery_phone, delivery_lat, delivery_lng, delivery_instructions,
  } = req.body;
  const tip = Math.max(0, parseFloat(tip_amount) || 0);
  const tableNum = (order_type === 'takeaway' || order_type === 'delivery') ? (order_type === 'delivery' ? 'Delivery' : 'Takeaway') : (table_number || '');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Verify café exists and is open — scoped by slug; fetch tax config + schedule + email + delivery config
    const cafeResult = await client.query(
      `SELECT id, email, is_open,
              COALESCE(gst_rate, 0)::int     AS gst_rate,
              COALESCE(tax_inclusive, false) AS tax_inclusive,
              opening_hours,
              COALESCE(timezone, 'Asia/Kolkata') AS timezone,
              latitude, longitude,
              COALESCE(delivery_enabled, false)   AS delivery_enabled,
              COALESCE(delivery_radius_km, 5)     AS delivery_radius_km,
              COALESCE(delivery_fee_base, 0)      AS delivery_fee_base,
              COALESCE(delivery_fee_per_km, 0)    AS delivery_fee_per_km,
              COALESCE(delivery_min_order, 0)     AS delivery_min_order,
              COALESCE(delivery_est_mins, 30)     AS delivery_est_mins
       FROM cafes WHERE slug = $1 AND is_active = true AND setup_completed = true`,
      [slug]
    );
    if (cafeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return fail(res, 'Café not found', 404);
    }
    const cafe = cafeResult.rows[0];
    if (cafe.is_open === false) {
      await client.query('ROLLBACK');
      return fail(res, 'This café is currently closed and not accepting orders', 403);
    }
    // Check time-based schedule (only when opening_hours are configured)
    const scheduleReason = scheduleBlock(cafe.opening_hours, cafe.timezone);
    if (scheduleReason) {
      await client.query('ROLLBACK');
      return fail(res, scheduleReason, 403);
    }
    const { id: cafeId, email: cafeEmail, gst_rate, tax_inclusive } = cafe;

    // Delivery-specific validation
    let deliveryFee = 0;
    if (order_type === 'delivery') {
      if (!cafe.delivery_enabled) {
        await client.query('ROLLBACK');
        return fail(res, 'This café does not offer delivery', 400);
      }
      // Validate customer is within delivery radius if café has coordinates and customer provided coords
      if (cafe.latitude && cafe.longitude && delivery_lat && delivery_lng) {
        const distKm = haversineKm(
          parseFloat(cafe.latitude), parseFloat(cafe.longitude),
          parseFloat(delivery_lat), parseFloat(delivery_lng)
        );
        if (distKm > parseFloat(cafe.delivery_radius_km)) {
          await client.query('ROLLBACK');
          return fail(res, `Delivery is only available within ${cafe.delivery_radius_km} km of this café`, 400);
        }
        // Calculate delivery fee: base + per_km * distance
        deliveryFee = parseFloat(cafe.delivery_fee_base) +
          parseFloat(cafe.delivery_fee_per_km) * distKm;
        deliveryFee = parseFloat(deliveryFee.toFixed(2));
      } else {
        deliveryFee = parseFloat(cafe.delivery_fee_base) || 0;
      }
    }

    // Validate all items belong to this café and are available — multi-tenant scoped
    const itemIds = items.map((i) => i.menu_item_id);
    const menuResult = await client.query(
      `SELECT id, name, price, track_stock, stock_quantity FROM menu_items
       WHERE id = ANY($1) AND cafe_id = $2 AND is_available = true
       FOR UPDATE`,
      [itemIds, cafeId]
    );

    if (menuResult.rows.length !== itemIds.length) {
      await client.query('ROLLBACK');
      return fail(res, 'One or more items are unavailable or invalid');
    }

    const menuMap = {};
    menuResult.rows.forEach((item) => { menuMap[item.id] = item; });

    // Stock check — reject if any tracked item has insufficient quantity
    for (const i of items) {
      const mi = menuMap[i.menu_item_id];
      if (mi.track_stock && mi.stock_quantity !== null && mi.stock_quantity < i.quantity) {
        await client.query('ROLLBACK');
        return fail(res, `"${mi.name}" only has ${mi.stock_quantity} left in stock`);
      }
    }

    // Calculate total server-side (never trust client price)
    let total = 0;
    const orderItems = items.map((i) => {
      const menuItem = menuMap[i.menu_item_id];
      const subtotal = parseFloat(menuItem.price) * i.quantity;
      total += subtotal;
      return { menu_item_id: i.menu_item_id, quantity: i.quantity, unit_price: menuItem.price, item_name: menuItem.name };
    });

    // Apply best active offer
    // Apply offer
    let offerId = null;
    let discountAmount = 0;
    let finalAmount = total;

    if (req.body.coupon_code) {
      const result = await applyCoupon(cafeId, req.body.coupon_code, items, total);
      offerId = result.offerId;
      discountAmount = result.discountAmount;
      finalAmount = result.finalAmount;
    } else {
      const result = await applyBestOffer(cafeId, items, total);
      offerId = result.offerId;
      discountAmount = result.discountAmount;
      finalAmount = result.finalAmount;
    }

    // 🔒 SAFETY FIX — ADD HERE
    if (offerId && typeof offerId === 'string' && offerId.length > 20) {
      logger.error('❌ offerId too long:', offerId);
      offerId = offerId.slice(0, 20);
    }

    // ── Tax calculation ────────────────────────────────────────
    // tax_inclusive = true  → prices already include GST; extract tax from total
    // tax_inclusive = false → prices are pre-tax; add GST on top
    const rate = parseInt(gst_rate || 0);
    let taxAmount = 0;
    let trueTotal = total;         // gross total paid by customer (before discount+tip)
    let trueFinal;                 // final amount after discount + tip

    if (rate > 0) {
      if (tax_inclusive) {
        // GST is baked into item prices — extract: tax = total × rate/(100+rate)
        taxAmount  = parseFloat((total * rate / (100 + rate)).toFixed(2));
        trueFinal  = finalAmount + tip + deliveryFee;
      } else {
        // GST is added on top of item prices
        taxAmount  = parseFloat((total * rate / 100).toFixed(2));
        trueTotal  = total + taxAmount;
        // Discount applies to pre-tax subtotal; tax on discounted base
        const discountedBase = total - discountAmount;
        taxAmount  = parseFloat((discountedBase * rate / 100).toFixed(2));
        trueFinal  = discountedBase + taxAmount + tip + deliveryFee;
      }
    } else {
      trueFinal = finalAmount + tip + deliveryFee;
    }

    // Insert order
    let orderResult;
    try {
      orderResult = await client.query(
        `INSERT INTO orders
           (cafe_id, customer_name, customer_phone, table_number, order_type,
            total_amount, discount_amount, tip_amount, final_amount,
            tax_amount, tax_rate,
            offer_id, notes, client_order_id,
            delivery_address, delivery_address2, delivery_city, delivery_zipcode,
            delivery_phone, delivery_lat, delivery_lng, delivery_instructions,
            delivery_fee, delivery_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 $15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         RETURNING id, order_number, customer_name, customer_phone, table_number, order_type,
                   status, total_amount, discount_amount, tip_amount, final_amount,
                   tax_amount, tax_rate, notes, created_at,
                   delivery_address, delivery_phone, delivery_fee, delivery_status`,
        [cafeId, customer_name, customer_phone || null, tableNum, order_type,
         trueTotal, discountAmount, tip, trueFinal,
         taxAmount, rate,
         offerId || null, notes || null, client_order_id || null,
         order_type === 'delivery' ? (delivery_address || null) : null,
         order_type === 'delivery' ? (delivery_address2 || null) : null,
         order_type === 'delivery' ? (delivery_city || null) : null,
         order_type === 'delivery' ? (delivery_zipcode || null) : null,
         order_type === 'delivery' ? (delivery_phone || null) : null,
         order_type === 'delivery' ? (delivery_lat || null) : null,
         order_type === 'delivery' ? (delivery_lng || null) : null,
         order_type === 'delivery' ? (delivery_instructions || null) : null,
         deliveryFee || 0,
         order_type === 'delivery' ? 'pending' : null]
      );
    } catch (insertErr) {
      await client.query('ROLLBACK');
      if (insertErr.code === '23505' && insertErr.constraint === 'orders_client_order_id_idx') {
        // Idempotent: return the existing order so the client can resume normally
        const existingResult = await db.query(
          'SELECT id FROM orders WHERE client_order_id = $1 AND cafe_id = $2',
          [client_order_id, cafeId]
        );
        if (existingResult.rows.length > 0) {
          const existing = await getOrderWithItems(existingResult.rows[0].id);
          return ok(res, { order: existing }, 'Order already placed', 200);
        }
        return fail(res, 'This order has already been placed', 409);
      }
      throw insertErr;
    }
    const order = orderResult.rows[0];

    // Bulk insert order items
    const valuePlaceholders = orderItems
      .map((_, i) => `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`)
      .join(', ');
    const itemValues = orderItems.flatMap((oi) => [oi.menu_item_id, oi.quantity, oi.unit_price, oi.item_name]);
    await client.query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, item_name) VALUES ${valuePlaceholders}`,
      [order.id, ...itemValues]
    );

    // Decrement stock and auto-disable sold-out items
    for (const i of items) {
      const mi = menuMap[i.menu_item_id];
      if (mi.track_stock && mi.stock_quantity !== null) {
        const newQty = mi.stock_quantity - i.quantity;
        await client.query(
          `UPDATE menu_items
           SET stock_quantity = $1,
               is_available   = CASE WHEN $1 <= 0 THEN false ELSE is_available END
           WHERE id = $2`,
          [newQty, i.menu_item_id]
        );
        if (newQty <= 0) {
          req.io?.to(`cafe:${cafeId}`).emit('item_sold_out', { menu_item_id: i.menu_item_id, name: mi.name });
          // Persist + email alert for sold-out (fire-and-forget, outside transaction)
          notify(req.io, cafeId, cafeEmail, {
            type:  'item_sold_out',
            title: `"${mi.name}" is sold out`,
            body:  'Stock hit zero — the item has been hidden from the menu.',
            refId: i.menu_item_id,
            email: true,
          }).catch(() => {});
        }
      }
    }

    await client.query('COMMIT');

    // Audit: initial order placement
    db.query(
      `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_name)
       VALUES ($1, NULL, 'pending', 'customer', $2)`,
      [order.id, customer_name]
    ).catch(() => {});

    const fullOrder = await getOrderWithItems(order.id);

    // Notify owner — persists in DB so they see it even after reconnect
    const orderLabel = order_type === 'delivery' ? 'Delivery' : order_type === 'takeaway' ? 'Takeaway' : `Table ${tableNum}`;
    const itemCount  = items.reduce((s, i) => s + i.quantity, 0);
    // Real-time: push full order to kitchen display and orders page
    if (req.io) {
      req.io.to(`cafe:${cafeId}`).emit('new_order', fullOrder);
    }

    notify(req.io, cafeId, cafeEmail, {
      type:  'new_order',
      title: `New order from ${customer_name}`,
      body:  `${orderLabel} · ${itemCount} item${itemCount !== 1 ? 's' : ''} · ₹${fullOrder.final_amount}`,
      refId: fullOrder.id,
    }).catch(() => {});

    logger.info('Order #%s placed at café %s table %s', order.order_number, slug, table_number);
    ok(res, { order: fullOrder }, 'Order placed', 201);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // re-throw — asyncHandler + global error middleware handles response
  } finally {
    client.release();
  }
});

// ─── Owner/Staff: get all orders ──────────────────────────────
exports.getOrders = asyncHandler(async (req, res) => {
  const { status, date, page = 1 } = req.query;
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (Math.max(parseInt(page), 1) - 1) * limit;

  let whereClause = 'WHERE o.cafe_id = $1';
  const params = [req.cafeId];
  let idx = 2;

  if (status) { whereClause += ` AND o.status = $${idx++}`; params.push(status); }
  if (date)   { whereClause += ` AND DATE(o.created_at) = $${idx++}`; params.push(date); }

  const [countResult, ordersResult] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM orders o ${whereClause}`, params),
    db.query(
      `SELECT o.id, o.order_number,
              COALESCE(o.daily_order_number, o.order_number) AS daily_order_number,
              o.customer_name, o.customer_phone, o.table_number,
              o.order_type, o.status, o.kitchen_mode,
              o.total_amount, o.tax_amount, o.tax_rate, o.discount_amount,
              o.tip_amount, o.delivery_fee, o.final_amount,
              o.payment_verified, o.cancellation_reason,
              o.notes, o.created_at, o.updated_at
       FROM orders o ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  // Batch-fetch all items in one query instead of N individual calls
  const orderIds = ordersResult.rows.map((o) => o.id);
  const itemsResult = orderIds.length > 0
    ? await db.query(
        'SELECT id, order_id, menu_item_id, item_name, quantity, unit_price, subtotal, item_status FROM order_items WHERE order_id = ANY($1)',
        [orderIds]
      )
    : { rows: [] };

  const itemsByOrderId = {};
  for (const item of itemsResult.rows) {
    if (!itemsByOrderId[item.order_id]) itemsByOrderId[item.order_id] = [];
    itemsByOrderId[item.order_id].push(item);
  }
  const orders = ordersResult.rows.map((o) => ({ ...o, items: itemsByOrderId[o.id] || [] }));

  ok(res, {
    orders,
    total: parseInt(countResult.rows[0].count),
    page: parseInt(page),
    limit,
  });
});

// ─── Owner/Staff: get single order ────────────────────────────
exports.getOrderById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await getOrderWithItems(id, req.cafeId);
  if (!order) return fail(res, 'Order not found', 404);
  ok(res, { order });
});

// ─── Owner/Staff: update order status ─────────────────────────
exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, cash_received, cancellation_reason } = req.body;

  const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'paid', 'cancelled'];
  if (!validStatuses.includes(status)) return fail(res, 'Invalid status');

  // Build dynamic SET clause
  const setClauses = ['status = $1'];
  const params = [status];
  let idx = 2;

  if (status === 'cancelled' && cancellation_reason) {
    setClauses.push(`cancellation_reason = $${idx++}`);
    params.push(cancellation_reason.trim().slice(0, 500));
  }
  if (status === 'paid' && cash_received != null) {
    setClauses.push(`cash_received = $${idx++}`, `change_amount = $${idx - 1} - total_amount`);
    params.push(cash_received);
  }

  params.push(id, req.cafeId);
  const idIdx   = idx++;
  const cafeIdx = idx;

  // Atomic read + write: capture old status and apply update in one round-trip
  const result = await db.query(
    `WITH prev AS (SELECT status FROM orders WHERE id = $${idIdx} AND cafe_id = $${cafeIdx})
     UPDATE orders SET ${setClauses.join(', ')}
     WHERE id = $${idIdx} AND cafe_id = $${cafeIdx}
     RETURNING id, order_number,
               COALESCE(daily_order_number, order_number) AS daily_order_number,
               customer_name, table_number, order_type, status,
               total_amount, cash_received, change_amount,
               cancellation_reason, updated_at,
               (SELECT status FROM prev) AS prev_status`,
    params
  );
  if (result.rows.length === 0) return fail(res, 'Order not found', 404);
  const fromStatus = result.rows[0].prev_status;

  // Log the status transition (fire-and-forget — don't fail the request if this errors)
  db.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, actor_name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, fromStatus, status,
     req.role === 'STAFF' ? 'staff' : 'owner',
     req.staffId || req.cafeId,
     null]
  ).catch(() => {});

  const updatedOrder = result.rows[0];
  if (req.io) {
    req.io.to(`cafe:${req.cafeId}`).emit('order_updated', updatedOrder);
    req.io.to(`order:${id}`).emit('order_updated', updatedOrder);
  }
  ok(res, { order: updatedOrder });
});

// ─── Owner: dashboard stats ───────────────────────────────────
exports.getDashboardStats = asyncHandler(async (req, res) => {
  const [todayStats, statusCounts, topItems, recentOrders] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'cancelled') AS total_orders,
         COALESCE(SUM(final_amount) FILTER (WHERE status = 'paid'), 0) AS total_revenue
       FROM orders
       WHERE cafe_id = $1 AND DATE(created_at) = CURRENT_DATE`,
      [req.cafeId]
    ),
    db.query(
      `SELECT status, COUNT(*) AS count FROM orders
       WHERE cafe_id = $1 AND DATE(created_at) = CURRENT_DATE GROUP BY status`,
      [req.cafeId]
    ),
    db.query(
      `SELECT oi.item_name, SUM(oi.quantity) AS total_qty, SUM(oi.subtotal) AS total_revenue
       FROM order_items oi JOIN orders o ON oi.order_id = o.id
       WHERE o.cafe_id = $1 AND o.created_at >= NOW() - INTERVAL '7 days' AND o.status = 'paid'
       GROUP BY oi.item_name ORDER BY total_qty DESC LIMIT 5`,
      [req.cafeId]
    ),
    db.query(
      `SELECT id, order_number,
            COALESCE(daily_order_number, order_number) AS daily_order_number,
            customer_name, table_number, status, total_amount, final_amount, created_at
       FROM orders WHERE cafe_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [req.cafeId]
    ),
  ]);

  ok(res, {
    today: todayStats.rows[0],
    statusBreakdown: statusCounts.rows,
    topItems: topItems.rows,
    recentOrders: recentOrders.rows,
  });
});

// ─── Public: Customer checks their order status (for polling) ─
exports.getOrderStatus = asyncHandler(async (req, res) => {
  const { slug, id } = req.params;
  const result = await db.query(
    `SELECT o.id, o.order_number,
            COALESCE(o.daily_order_number, o.order_number) AS daily_order_number,
            o.status, o.order_type, o.customer_name, o.table_number, o.updated_at,
            o.total_amount, o.tax_amount, o.tax_rate, o.discount_amount,
            o.tip_amount, o.delivery_fee, o.final_amount, o.cancellation_reason,
            o.delivery_status, o.delivery_address, o.delivery_lat, o.delivery_lng,
            o.driver_name, o.driver_phone, o.driver_lat, o.driver_lng,
            o.driver_updated_at, o.delivered_at, o.delivery_failed_reason,
            o.delivery_token,
            c.latitude AS cafe_lat, c.longitude AS cafe_lng, c.name AS cafe_name
     FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND c.slug = $2`,
    [id, slug]
  );
  if (result.rows.length === 0) return fail(res, 'Order not found', 404);
  ok(res, { order: result.rows[0] });
});

// ─── Public: Driver updates their GPS location ─────────────────
// URL is shared by owner to driver — token authenticates without login
exports.updateDriverLocation = asyncHandler(async (req, res) => {
  const { orderId, token } = req.params;
  const { lat, lng } = req.body;
  if (!lat || !lng) return fail(res, 'lat and lng are required', 400);

  const parsed = { lat: parseFloat(lat), lng: parseFloat(lng) };
  if (isNaN(parsed.lat) || isNaN(parsed.lng)) return fail(res, 'Invalid coordinates', 400);

  const result = await db.query(
    `UPDATE orders
     SET driver_lat = $1, driver_lng = $2, driver_updated_at = NOW()
     WHERE id = $3 AND delivery_token = $4 AND order_type = 'delivery'
     RETURNING id, driver_lat, driver_lng, driver_updated_at, delivery_status`,
    [parsed.lat, parsed.lng, orderId, token]
  );

  if (result.rows.length === 0) return fail(res, 'Invalid tracking link', 403);

  // Broadcast live driver position to customer tracking screen
  req.io?.to(`order:${orderId}`).emit('driver_location', {
    order_id: orderId,
    lat:      parsed.lat,
    lng:      parsed.lng,
    updated_at: result.rows[0].driver_updated_at,
  });

  ok(res, { updated: true });
});

// ─── Public: Get order info for driver tracking page ───────────
exports.getDriverOrderInfo = asyncHandler(async (req, res) => {
  const { orderId, token } = req.params;
  const result = await db.query(
    `SELECT o.id, o.customer_name, o.delivery_address, o.delivery_status,
            o.delivery_lat, o.delivery_lng,
            c.name AS cafe_name, c.address AS cafe_address,
            c.latitude AS cafe_lat, c.longitude AS cafe_lng
     FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND o.delivery_token = $2 AND o.order_type = 'delivery'`,
    [orderId, token]
  );
  if (result.rows.length === 0) return fail(res, 'Invalid tracking link', 403);
  ok(res, { order: result.rows[0] });
});

// ─── Public: Customer cancels their own order (pending only) ──
exports.customerCancelOrder = asyncHandler(async (req, res) => {
  const { slug, id } = req.params;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { customer_name, customer_phone } = req.body;

    // Lock the row and verify the caller is the actual customer
    const result = await client.query(
      `SELECT o.id, o.status, o.cafe_id, o.customer_name, o.customer_phone
       FROM orders o
       JOIN cafes c ON o.cafe_id = c.id
       WHERE o.id = $1 AND c.slug = $2
       FOR UPDATE`,
      [id, slug]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return fail(res, 'Order not found', 404);
    }

    const order = result.rows[0];
    const nameMatch  = customer_name  && order.customer_name  && order.customer_name.trim().toLowerCase()  === customer_name.trim().toLowerCase();
    const phoneMatch = customer_phone && order.customer_phone && order.customer_phone.trim() === customer_phone.trim();
    if (!nameMatch && !phoneMatch) {
      await client.query('ROLLBACK');
      return fail(res, 'Order not found', 404); // intentionally vague to not leak info
    }

    if (order.status !== 'pending') {
      await client.query('ROLLBACK');
      return fail(res, 'Order can only be cancelled while it is still pending', 400);
    }

    const updated = await client.query(
      `UPDATE orders SET status = 'cancelled'
       WHERE id = $1
       RETURNING id, order_number,
                 COALESCE(daily_order_number, order_number) AS daily_order_number,
                 customer_name, table_number, status, total_amount, updated_at`,
      [id]
    );

    // Audit log — inside the same transaction so it only persists if update succeeds
    await client.query(
      `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_name)
       VALUES ($1, 'pending', 'cancelled', 'customer', $2)`,
      [id, order.customer_name || 'Customer']
    );

    await client.query('COMMIT');

    const updatedOrder = updated.rows[0];
    if (req.io) {
      req.io.to(`cafe:${order.cafe_id}`).emit('order_updated', updatedOrder);
      req.io.to(`order:${id}`).emit('order_updated', updatedOrder);
    }

    logger.info('Order #%s cancelled by customer', updatedOrder.order_number);
    ok(res, { order: updatedOrder }, 'Order cancelled');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // re-throw — asyncHandler + global error middleware handles response
  } finally {
    client.release();
  }
});

// ─── Public: Combined bill for a table (all active orders) ────
exports.getTableBill = asyncHandler(async (req, res) => {
  const { slug, tableNumber } = req.params;

  const cafeResult = await db.query(
    `SELECT id, name, gst_rate, gst_number FROM cafes WHERE slug = $1 AND is_active = true`,
    [slug]
  );
  if (cafeResult.rows.length === 0) return fail(res, 'Café not found', 404);
  const { id: cafeId, name: cafeName, gst_rate, gst_number } = cafeResult.rows[0];

  const ordersResult = await db.query(
    `SELECT id, order_number,
            COALESCE(daily_order_number, order_number) AS daily_order_number,
            status, total_amount, discount_amount, tip_amount, final_amount,
            notes, created_at
     FROM orders
     WHERE cafe_id = $1
       AND table_number = $2
       AND status NOT IN ('cancelled', 'paid')
     ORDER BY created_at ASC`,
    [cafeId, tableNumber]
  );

  if (ordersResult.rows.length === 0) {
    return ok(res, { orders: [], combined_total: 0, cafe_name: cafeName });
  }

  // Verify the requester is one of the customers at this table
  const { customer_name } = req.query;
  if (customer_name) {
    const nameMatch = ordersResult.rows.some(
      (o) => o.customer_name && o.customer_name.trim().toLowerCase() === customer_name.trim().toLowerCase()
    );
    if (!nameMatch) return fail(res, 'Table bill not found', 404);
  }

  const orderIds = ordersResult.rows.map((o) => o.id);
  const itemsResult = await db.query(
    'SELECT order_id, item_name, quantity, unit_price, subtotal FROM order_items WHERE order_id = ANY($1)',
    [orderIds]
  );

  const itemsByOrder = {};
  for (const item of itemsResult.rows) {
    if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
    itemsByOrder[item.order_id].push(item);
  }

  const orders = ordersResult.rows.map((o) => ({ ...o, items: itemsByOrder[o.id] || [] }));
  const combinedTotal = orders.reduce((sum, o) => sum + parseFloat(o.final_amount || o.total_amount), 0);
  const combinedTip   = orders.reduce((sum, o) => sum + parseFloat(o.tip_amount || 0), 0);

  ok(res, {
    cafe_name:      cafeName,
    table_number:   tableNumber,
    orders,
    combined_total: parseFloat(combinedTotal.toFixed(2)),
    combined_tip:   parseFloat(combinedTip.toFixed(2)),
    gst_rate:       parseInt(gst_rate || 0),
    gst_number:     gst_number || null,
  });
});

// ─── Helper ───────────────────────────────────────────────────
async function getOrderWithItems(orderId, cafeId = null) {
  const params = [orderId];
  const cafeFilter = cafeId ? ' AND o.cafe_id = $2' : '';
  if (cafeId) params.push(cafeId);

  const [orderResult, itemsResult] = await Promise.all([
    db.query(
      `SELECT o.id, o.order_number,
              COALESCE(o.daily_order_number, o.order_number) AS daily_order_number,
              o.customer_name, o.customer_phone, o.table_number,
              o.order_type, o.status,
              o.total_amount, o.tax_amount, o.tax_rate, o.discount_amount,
              o.tip_amount, o.delivery_fee, o.final_amount,
              o.payment_verified, o.cancellation_reason,
              o.notes, o.created_at, o.updated_at,
              o.delivery_address, o.delivery_address2, o.delivery_city, o.delivery_zipcode,
              o.delivery_phone, o.delivery_instructions, o.delivery_status,
              o.driver_name, o.driver_phone, o.delivered_at, o.delivery_failed_reason,
              o.kitchen_mode
       FROM orders o WHERE o.id = $1${cafeFilter}`,
      params
    ),
    db.query(
      `SELECT id, menu_item_id, item_name, quantity, unit_price, subtotal,
              item_status, accepted, cancellation_reason,
              COALESCE(sort_order, 0) AS sort_order,
              preparing_at, ready_at, served_at, cancelled_at
       FROM order_items WHERE order_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [orderId]
    ),
  ]);

  if (orderResult.rows.length === 0) return null;
  return { ...orderResult.rows[0], items: itemsResult.rows };
}

// ─── Public: Create Razorpay order for food payment ───────────
exports.createOrderPayment = asyncHandler(async (req, res) => {
  const { slug, id } = req.params;

  // Fetch the order, verify it belongs to this slug and is payable
  const result = await db.query(
    `SELECT o.id, o.status, o.final_amount, o.total_amount, o.payment_verified,
            o.customer_name, o.order_number,
            COALESCE(o.daily_order_number, o.order_number) AS daily_order_number,
            c.name AS cafe_name, c.email AS cafe_email,
            c.logo_url AS cafe_logo_url, c.currency AS cafe_currency,
            c.razorpay_account_id, c.razorpay_route_enabled
     FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND c.slug = $2`,
    [id, slug]
  );

  if (result.rows.length === 0) return fail(res, 'Order not found', 404);
  const order = result.rows[0];

  if (order.payment_verified) return fail(res, 'Order already paid', 409);
  if (['cancelled', 'paid'].includes(order.status)) {
    return fail(res, 'Cannot process payment for this order', 400);
  }

  const amountPaise = Math.round(parseFloat(order.final_amount || order.total_amount) * 100);
  if (amountPaise <= 0) return fail(res, 'Invalid order amount', 400);

  // Build Razorpay Route transfer — 1% commission to platform, 99% to café
  const routeTransfers = [];
  if (order.razorpay_route_enabled && order.razorpay_account_id) {
    // Minimum transfer is ₹1 (100 paise); skip routing for tiny orders
    const cafeSharePaise = Math.floor(amountPaise * 0.99);
    if (cafeSharePaise >= 100) {
      routeTransfers.push({
        account:  order.razorpay_account_id,
        amount:   cafeSharePaise,
        currency: 'INR',
        on_hold:  0,
        notes: {
          cafe_slug: slug,
          order_id:  id,
          type:      'food_order_payout',
        },
      });
    }
  }

  const rpOrder = await razorpay.orders.create({
    amount:   amountPaise,
    currency: 'INR',
    receipt:  `ord_${id.slice(0, 8)}_${Date.now()}`,
    notes: {
      order_id:   id,
      cafe_slug:  slug,
      cafe_name:  order.cafe_name,
      daily_num:  order.daily_order_number,
    },
    ...(routeTransfers.length > 0 && { transfers: routeTransfers }),
  });

  // Store Razorpay order id so we can verify later
  await db.query(
    'UPDATE orders SET payment_order_id = $1 WHERE id = $2',
    [rpOrder.id, id]
  );

  ok(res, {
    razorpay_order_id:   rpOrder.id,
    amount:              amountPaise,
    currency:            order.cafe_currency || 'INR',
    cafe_name:           order.cafe_name,
    cafe_logo_url:       order.cafe_logo_url || null,
    customer_name:       order.customer_name,
    daily_order_number:  order.daily_order_number,
    route_enabled:       routeTransfers.length > 0,
    key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
  });
});

// ─── Public: Verify payment + mark order paid ─────────────────
exports.verifyOrderPayment = asyncHandler(async (req, res) => {
  const { slug, id } = req.params;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return fail(res, 'Missing payment fields', 400);
  }

  // Verify HMAC signature
  const secret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET;
  if (!secret) return fail(res, 'Payment gateway not configured', 503);

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature) {
    logger.warn('Invalid Razorpay signature for food order %s', id);
    return fail(res, 'Payment verification failed', 400);
  }

  // Fetch and lock the order row — prevents duplicate payment processing under concurrent requests
  const payClient = await db.pool.connect();
  let updatedOrder;
  let cafeId;
  try {
    await payClient.query('BEGIN');

    const result = await payClient.query(
      `SELECT o.id, o.status, o.payment_order_id, o.payment_verified, o.cafe_id,
              COALESCE(o.daily_order_number, o.order_number) AS daily_order_number,
              o.table_number, o.order_type, o.final_amount
       FROM orders o
       JOIN cafes c ON o.cafe_id = c.id
       WHERE o.id = $1 AND c.slug = $2
       FOR UPDATE`,
      [id, slug]
    );

    if (result.rows.length === 0) {
      await payClient.query('ROLLBACK');
      return fail(res, 'Order not found', 404);
    }
    const order = result.rows[0];
    cafeId = order.cafe_id;

    if (order.payment_verified) {
      await payClient.query('ROLLBACK');
      return fail(res, 'Already paid', 409);
    }
    if (order.payment_order_id !== razorpay_order_id) {
      await payClient.query('ROLLBACK');
      return fail(res, 'Order ID mismatch', 400);
    }

    // Verify the actual amount charged matches the order total — prevents underpayment
    try {
      const rzpPayment = await razorpay.payments.fetch(razorpay_payment_id);
      const expectedPaise = Math.round(parseFloat(order.final_amount) * 100);
      if (parseInt(rzpPayment.amount, 10) !== expectedPaise) {
        logger.warn('Amount mismatch for food order %s: expected %d paise, got %d', id, expectedPaise, rzpPayment.amount);
        await payClient.query('ROLLBACK');
        return fail(res, 'Payment amount mismatch', 400);
      }
    } catch (fetchErr) {
      logger.warn('Could not fetch payment %s for amount check on food order %s: %s', razorpay_payment_id, id, fetchErr.message);
      await payClient.query('ROLLBACK');
      return fail(res, 'Payment verification temporarily unavailable. Please try again in a moment.', 503);
    }

    // Mark paid inside the transaction so the lock is held until commit
    const updated = await payClient.query(
      `UPDATE orders
       SET status = 'paid', payment_id = $1, payment_verified = true, updated_at = NOW()
       WHERE id = $2
       RETURNING id, order_number,
                 COALESCE(daily_order_number, order_number) AS daily_order_number,
                 customer_name, table_number, order_type, status,
                 total_amount, final_amount, updated_at`,
      [razorpay_payment_id, id]
    );
    updatedOrder = updated.rows[0];

    await payClient.query('COMMIT');
  } catch (err) {
    await payClient.query('ROLLBACK');
    throw err;
  } finally {
    payClient.release();
  }

  // Emit to owner/kitchen via socket
  if (req.io) {
    req.io.to(`cafe:${cafeId}`).emit('order_updated', updatedOrder);
    req.io.to(`order:${id}`).emit('order_updated', updatedOrder);
  }

  logger.info('Food payment verified: order %s cafe %s amount paid', id, slug);
  ok(res, { order: updatedOrder }, 'Payment successful!');
});

// ─── Owner/Staff: set kitchen mode (combined | individual) ────
exports.setKitchenMode = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { mode } = req.body;
  if (!['combined', 'individual'].includes(mode)) return fail(res, 'Invalid kitchen mode');

  const orderCheck = await db.query(
    'SELECT id, status FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, req.cafeId]
  );
  if (orderCheck.rows.length === 0) return fail(res, 'Order not found', 404);
  if (['paid', 'cancelled'].includes(orderCheck.rows[0].status))
    return fail(res, 'Cannot change mode on a completed order');

  await db.query(
    'UPDATE orders SET kitchen_mode = $1, updated_at = NOW() WHERE id = $2',
    [mode, id]
  );

  // When switching to individual, reset all item statuses to pending
  if (mode === 'individual') {
    await db.query(
      "UPDATE order_items SET item_status = 'pending' WHERE order_id = $1",
      [id]
    );
  }

  const fullOrder = await getOrderWithItems(id, req.cafeId);
  if (req.io) {
    req.io.to(`cafe:${req.cafeId}`).emit('order_updated', fullOrder);
  }
  ok(res, { order: fullOrder });
});

// ─── Owner/Staff: update a single item's status (individual mode) ─
exports.updateItemStatus = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { status } = req.body;

  const validStatuses = ['pending', 'preparing', 'ready', 'served'];
  if (!validStatuses.includes(status)) return fail(res, 'Invalid item status');

  const orderCheck = await db.query(
    'SELECT id, kitchen_mode, status FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, req.cafeId]
  );
  if (orderCheck.rows.length === 0) return fail(res, 'Order not found', 404);
  const order = orderCheck.rows[0];
  if (order.kitchen_mode !== 'individual') return fail(res, 'Order is not in individual mode');
  if (['paid', 'cancelled'].includes(order.status)) return fail(res, 'Order is already completed');

  // Fetch current item status to enforce forward-only transitions
  const currentItem = await db.query(
    'SELECT item_status FROM order_items WHERE id = $1 AND order_id = $2',
    [itemId, id]
  );
  if (currentItem.rows.length === 0) return fail(res, 'Item not found', 404);
  const currentStatus = currentItem.rows[0].item_status;
  const ALLOWED_TRANSITIONS = {
    pending:   ['preparing'],
    preparing: ['ready', 'pending'],
    ready:     ['served', 'preparing'],
    served:    [],
  };
  if (!(ALLOWED_TRANSITIONS[currentStatus] || []).includes(status)) {
    return fail(res, `Cannot change item status from '${currentStatus}' to '${status}'`, 400);
  }

  // Set the relevant timestamp column alongside item_status
  const tsMap = { preparing: 'preparing_at', ready: 'ready_at', served: 'served_at' };
  const tsCol = tsMap[status];
  const itemResult = await db.query(
    `UPDATE order_items SET item_status = $1${tsCol ? `, ${tsCol} = NOW()` : ''}
     WHERE id = $2 AND order_id = $3 RETURNING id`,
    [status, itemId, id]
  );
  if (itemResult.rows.length === 0) return fail(res, 'Item not found', 404);

  // Emit item-level status update to customer tracking the order
  if (req.io) {
    req.io.to(`order:${id}`).emit('item_status_update', {
      orderId: id, itemId, status, timestamp: new Date().toISOString(),
    });
  }

  // Auto-advance order status based on all item statuses
  const allItems = await db.query(
    'SELECT item_status FROM order_items WHERE order_id = $1',
    [id]
  );
  const statuses = allItems.rows.map((r) => r.item_status);
  // Treat cancelled items as "done" so they don't block order progression
  const allServed        = statuses.every((s) => s === 'served' || s === 'cancelled');
  const allReadyOrServed = statuses.every((s) => ['ready', 'served', 'cancelled'].includes(s));
  const anyActive        = statuses.some((s) => !['pending', 'cancelled'].includes(s));

  let newOrderStatus = order.status;
  if (allServed) newOrderStatus = 'served';
  else if (allReadyOrServed) newOrderStatus = 'ready';
  else if (anyActive && ['pending', 'confirmed'].includes(order.status)) newOrderStatus = 'preparing';

  if (newOrderStatus !== order.status) {
    await db.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
      [newOrderStatus, id]
    );
    db.query(
      `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, actor_name)
       VALUES ($1, $2, $3, 'system', $4, 'Auto (KOT)')`,
      [id, order.status, newOrderStatus, req.cafeId]
    ).catch(() => {});
  }

  const fullOrder = await getOrderWithItems(id, req.cafeId);
  if (req.io) {
    req.io.to(`cafe:${req.cafeId}`).emit('order_updated', fullOrder);
    req.io.to(`order:${id}`).emit('order_updated', fullOrder);
  }
  ok(res, { order: fullOrder });
});

// Accept entire order (kitchen staff accepts all items)
exports.acceptOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { cafeId } = req;

  const order = await db.query(
    'SELECT * FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, cafeId]
  );
  if (order.rows.length === 0) return fail(res, 'Order not found', 404);

  const orderData = order.rows[0];
  if (orderData.kitchen_mode !== 'individual') return fail(res, 'Order acceptance only available in individual mode', 400);
  if (orderData.accepted) return fail(res, 'Order already accepted', 400);

  await db.query(
    'UPDATE orders SET accepted = true, acceptance_time = NOW(), updated_at = NOW() WHERE id = $1',
    [id]
  );
  await db.query('UPDATE order_items SET accepted = true WHERE order_id = $1', [id]);
  await db.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, actor_name)
     VALUES ($1, $2, $3, 'staff', $4, $5)`,
    [id, orderData.status, orderData.status, req.staffId || req.cafeId, 'Staff']
  );

  const fullOrder = await getOrderWithItems(id, cafeId);
  if (req.io) {
    req.io.to(`cafe:${cafeId}`).emit('order_updated', fullOrder);
    req.io.to(`order:${id}`).emit('order_updated', fullOrder);
  }
  ok(res, { order: fullOrder });
});

// Reject entire order (kitchen staff rejects all items)
exports.rejectOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const { cafeId } = req;

  if (!reason?.trim()) return fail(res, 'Rejection reason is required', 400);

  const order = await db.query(
    'SELECT * FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, cafeId]
  );
  if (order.rows.length === 0) return fail(res, 'Order not found', 404);

  const orderData = order.rows[0];
  if (orderData.kitchen_mode !== 'individual') return fail(res, 'Order rejection only available in individual mode', 400);
  if (orderData.accepted) return fail(res, 'Cannot reject an already accepted order', 400);

  await db.query(
    "UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
    [id]
  );
  await db.query(
    'UPDATE order_items SET item_status = $1, cancellation_reason = $2 WHERE order_id = $3',
    ['cancelled', reason, id]
  );
  await db.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, actor_name)
     VALUES ($1, $2, $3, 'staff', $4, $5)`,
    [id, orderData.status, 'cancelled', req.staffId || req.cafeId, 'Staff']
  );

  const fullOrder = await getOrderWithItems(id, cafeId);
  if (req.io) {
    req.io.to(`cafe:${cafeId}`).emit('order_updated', fullOrder);
    req.io.to(`order:${id}`).emit('order_updated', fullOrder);
  }
  ok(res, { order: fullOrder });
});

// Accept individual item
exports.acceptItem = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { cafeId } = req;

  const order = await db.query(
    'SELECT * FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, cafeId]
  );
  if (order.rows.length === 0) return fail(res, 'Order not found', 404);

  const orderData = order.rows[0];
  if (orderData.kitchen_mode !== 'individual') return fail(res, 'Item acceptance only available in individual mode', 400);

  const item = await db.query(
    'SELECT * FROM order_items WHERE id = $1 AND order_id = $2',
    [itemId, id]
  );
  if (item.rows.length === 0) return fail(res, 'Item not found', 404);
  if (item.rows[0].accepted) return fail(res, 'Item already accepted', 400);

  await db.query('UPDATE order_items SET accepted = true WHERE id = $1', [itemId]);
  await db.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, actor_name)
     VALUES ($1, $2, $3, 'staff', $4, $5)`,
    [id, orderData.status, orderData.status, req.staffId || req.cafeId, 'Staff']
  );

  const fullOrder = await getOrderWithItems(id, cafeId);
  if (req.io) {
    req.io.to(`cafe:${cafeId}`).emit('order_updated', fullOrder);
    req.io.to(`order:${id}`).emit('order_updated', fullOrder);
  }
  ok(res, { order: fullOrder });
});

// Reject individual item
exports.rejectItem = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { reason } = req.body;
  const { cafeId } = req;

  if (!reason?.trim()) return fail(res, 'Rejection reason is required', 400);

  const order = await db.query(
    'SELECT * FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, cafeId]
  );
  if (order.rows.length === 0) return fail(res, 'Order not found', 404);

  const orderData = order.rows[0];
  if (orderData.kitchen_mode !== 'individual') return fail(res, 'Item rejection only available in individual mode', 400);

  const item = await db.query(
    'SELECT * FROM order_items WHERE id = $1 AND order_id = $2',
    [itemId, id]
  );
  if (item.rows.length === 0) return fail(res, 'Item not found', 404);
  if (item.rows[0].accepted) return fail(res, 'Cannot reject an already accepted item', 400);

  await db.query(
    'UPDATE order_items SET item_status = $1, cancellation_reason = $2 WHERE id = $3',
    ['cancelled', reason, itemId]
  );
  await db.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, actor_name)
     VALUES ($1, $2, $3, 'staff', $4, $5)`,
    [id, orderData.status, orderData.status, req.staffId || req.cafeId, 'Staff']
  );

  const fullOrder = await getOrderWithItems(id, cafeId);
  if (req.io) {
    req.io.to(`cafe:${cafeId}`).emit('order_updated', fullOrder);
    req.io.to(`order:${id}`).emit('order_updated', fullOrder);
  }
  ok(res, { order: fullOrder });
});

// ─── Kitchen: cancel an item after acceptance (item unavailable) ─
exports.cancelItem = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { reason } = req.body;
  const { cafeId } = req;

  if (!reason?.trim()) return fail(res, 'Cancellation reason is required', 400);

  const orderCheck = await db.query(
    'SELECT id, status FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, cafeId]
  );
  if (orderCheck.rows.length === 0) return fail(res, 'Order not found', 404);
  if (['paid', 'cancelled'].includes(orderCheck.rows[0].status)) return fail(res, 'Order is already completed');

  const itemResult = await db.query(
    `UPDATE order_items
     SET item_status = 'cancelled', cancellation_reason = $1, cancelled_at = NOW()
     WHERE id = $2 AND order_id = $3 AND item_status != 'cancelled'
     RETURNING id, item_name`,
    [reason.trim(), itemId, id]
  );
  if (itemResult.rows.length === 0) return fail(res, 'Item not found or already cancelled', 404);

  // Void entire order if every item is now cancelled
  const remaining = await db.query(
    "SELECT COUNT(*) FROM order_items WHERE order_id = $1 AND item_status != 'cancelled'",
    [id]
  );
  if (parseInt(remaining.rows[0].count, 10) === 0) {
    await db.query(
      "UPDATE orders SET status = 'cancelled', cancellation_reason = 'All items unavailable', updated_at = NOW() WHERE id = $1",
      [id]
    );
  }

  const fullOrder = await getOrderWithItems(id, cafeId);
  if (req.io) {
    req.io.to(`cafe:${cafeId}`).emit('order_updated', fullOrder);
    req.io.to(`order:${id}`).emit('order_updated', fullOrder);
    req.io.to(`order:${id}`).emit('item_cancelled', {
      orderId: parseInt(id, 10),
      itemId: parseInt(itemId, 10),
      itemName: itemResult.rows[0].item_name,
      reason: reason.trim(),
    });
  }
  ok(res, { order: fullOrder });
});

// ─── Kitchen: update sort_order for items (course sequencing) ──
exports.reorderItems = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { items } = req.body; // [{ id, sort_order }]
  const { cafeId } = req;

  if (!Array.isArray(items) || items.length === 0) return fail(res, 'items array required', 400);

  const orderCheck = await db.query(
    'SELECT id FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, cafeId]
  );
  if (orderCheck.rows.length === 0) return fail(res, 'Order not found', 404);

  for (const item of items) {
    await db.query(
      'UPDATE order_items SET sort_order = $1 WHERE id = $2 AND order_id = $3',
      [item.sort_order, item.id, id]
    );
  }

  const fullOrder = await getOrderWithItems(id, cafeId);
  if (req.io) {
    req.io.to(`cafe:${cafeId}`).emit('order_updated', fullOrder);
  }
  ok(res, { order: fullOrder });
});

// ─── Kitchen: generate KOT slip for currently-ready items ──────
exports.generateKot = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { cafeId } = req;

  const orderCheck = await db.query(
    'SELECT id, table_number, customer_name, kitchen_mode FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, cafeId]
  );
  if (orderCheck.rows.length === 0) return fail(res, 'Order not found', 404);
  const order = orderCheck.rows[0];

  // Combined mode: print all non-cancelled items (no "ready" requirement)
  // Individual mode: only 'ready' items not already in a previous slip
  let readyItems;
  if (order.kitchen_mode === 'combined') {
    readyItems = await db.query(
      `SELECT oi.id, oi.item_name, oi.quantity
       FROM order_items oi
       WHERE oi.order_id = $1 AND oi.item_status != 'cancelled'
       ORDER BY oi.sort_order ASC, oi.id ASC`,
      [id]
    );
  } else {
    readyItems = await db.query(
      `SELECT oi.id, oi.item_name, oi.quantity
       FROM order_items oi
       WHERE oi.order_id = $1
         AND oi.item_status = 'ready'
         AND oi.id NOT IN (
           SELECT (elem->>'id')::uuid
           FROM kot_slips k, jsonb_array_elements(k.items) AS elem
           WHERE k.order_id = $1
         )
       ORDER BY oi.sort_order ASC, oi.id ASC`,
      [id]
    );
  }

  if (readyItems.rows.length === 0) return fail(res, 'No items to print KOT for', 400);

  const slipCount = await db.query(
    'SELECT COALESCE(MAX(slip_number), 0) AS max_slip FROM kot_slips WHERE order_id = $1',
    [id]
  );
  const slipNumber = slipCount.rows[0].max_slip + 1;

  const slip = await db.query(
    `INSERT INTO kot_slips (cafe_id, order_id, slip_number, table_number, customer_name, items, printed_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
     RETURNING *`,
    [cafeId, id, slipNumber, order.table_number, order.customer_name, JSON.stringify(readyItems.rows)]
  );

  ok(res, { kot: slip.rows[0] });
});

// ─── Kitchen: get KOT history for an order (for reprint) ───────
exports.getKotHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { cafeId } = req;

  const orderCheck = await db.query('SELECT id FROM orders WHERE id = $1 AND cafe_id = $2', [id, cafeId]);
  if (orderCheck.rows.length === 0) return fail(res, 'Order not found', 404);

  const slips = await db.query(
    'SELECT * FROM kot_slips WHERE order_id = $1 ORDER BY slip_number ASC',
    [id]
  );
  ok(res, { slips: slips.rows });
});
