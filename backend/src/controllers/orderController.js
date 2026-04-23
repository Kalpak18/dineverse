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
    const { offerId, discountAmount, finalAmount } = await applyBestOffer(cafeId, items, total);

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
    notify(req.io, cafeId, cafeEmail, {
      type:  'new_order',
      title: `New order from ${customer_name}`,
      body:  `${orderLabel} · ${itemCount} item${itemCount !== 1 ? 's' : ''} · ₹${fullOrder.final_amount}`,
      refId: fullOrder.id,
      email: true,
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
  const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
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
              o.total_amount, o.discount_amount, o.final_amount,
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
         COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0) AS total_revenue
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
            customer_name, table_number, status, total_amount, created_at
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
            o.status, o.order_type, o.customer_name, o.table_number, o.updated_at
     FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND c.slug = $2`,
    [id, slug]
  );
  if (result.rows.length === 0) return fail(res, 'Order not found', 404);
  ok(res, { order: result.rows[0] });
});

// ─── Public: Customer cancels their own order (pending only) ──
exports.customerCancelOrder = asyncHandler(async (req, res) => {
  const { slug, id } = req.params;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row to prevent race conditions
    const result = await client.query(
      `SELECT o.id, o.status, o.cafe_id
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
              o.total_amount, o.discount_amount, o.final_amount,
              o.payment_verified, o.cancellation_reason,
              o.notes, o.created_at, o.updated_at,
              o.delivery_address, o.delivery_address2, o.delivery_city, o.delivery_zipcode,
              o.delivery_phone, o.delivery_instructions, o.delivery_fee, o.delivery_status,
              o.driver_name, o.driver_phone, o.delivered_at, o.delivery_failed_reason,
              o.kitchen_mode
       FROM orders o WHERE o.id = $1${cafeFilter}`,
      params
    ),
    db.query(
      'SELECT id, menu_item_id, item_name, quantity, unit_price, subtotal, item_status FROM order_items WHERE order_id = $1',
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
            c.name AS cafe_name, c.email AS cafe_email
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

  const rpOrder = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: `ord_${id.slice(0, 8)}_${Date.now()}`,
    notes: {
      order_id:   id,
      cafe_slug:  slug,
      cafe_name:  order.cafe_name,
      daily_num:  order.daily_order_number,
    },
  });

  // Store Razorpay order id so we can verify later
  await db.query(
    'UPDATE orders SET payment_order_id = $1 WHERE id = $2',
    [rpOrder.id, id]
  );

  ok(res, {
    razorpay_order_id: rpOrder.id,
    amount:            amountPaise,
    currency:          'INR',
    cafe_name:         order.cafe_name,
    customer_name:     order.customer_name,
    daily_order_number: order.daily_order_number,
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
      // HMAC signature already verified — allow the payment to proceed
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

  const itemResult = await db.query(
    'UPDATE order_items SET item_status = $1 WHERE id = $2 AND order_id = $3 RETURNING id',
    [status, itemId, id]
  );
  if (itemResult.rows.length === 0) return fail(res, 'Item not found', 404);

  // Auto-advance order status based on all item statuses
  const allItems = await db.query(
    'SELECT item_status FROM order_items WHERE order_id = $1',
    [id]
  );
  const statuses = allItems.rows.map((r) => r.item_status);
  const allServed       = statuses.every((s) => s === 'served');
  const allReadyOrServed = statuses.every((s) => s === 'ready' || s === 'served');
  const anyActive       = statuses.some((s) => s !== 'pending');

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
