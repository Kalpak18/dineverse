const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('../config/database');
const logger = require('../utils/logger');
const { ok, fail, validationFail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const { applyBestOffer } = require('./offerController');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID     || process.env.RAZORPAY_TEST_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET,
});

// ─── Public: Customer places an order ─────────────────────────
exports.validateOrder = [
  body('customer_name').trim().notEmpty().withMessage('Your name is required'),
  body('order_type')
    .optional()
    .isIn(['dine-in', 'takeaway']).withMessage('order_type must be dine-in or takeaway'),
  body('table_number')
    .if(body('order_type').not().equals('takeaway'))
    .trim().notEmpty().withMessage('Table number is required for dine-in orders'),
  body('customer_phone').optional().trim().isLength({ max: 20 }),
  body('client_order_id').optional().trim().isLength({ max: 64 }),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.menu_item_id').notEmpty().withMessage('menu_item_id is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
];

exports.createOrder = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { slug } = req.params;
  const { customer_name, customer_phone, table_number, items, notes, order_type = 'dine-in', client_order_id } = req.body;
  const tableNum = order_type === 'takeaway' ? 'Takeaway' : (table_number || '');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Verify café exists — scoped by slug
    const cafeResult = await client.query(
      'SELECT id FROM cafes WHERE slug = $1 AND is_active = true',
      [slug]
    );
    if (cafeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return fail(res, 'Café not found', 404);
    }
    const cafeId = cafeResult.rows[0].id;

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

    // Insert order
    let orderResult;
    try {
      orderResult = await client.query(
        `INSERT INTO orders
           (cafe_id, customer_name, customer_phone, table_number, order_type,
            total_amount, discount_amount, final_amount, offer_id, notes, client_order_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, order_number, customer_name, customer_phone, table_number, order_type,
                   status, total_amount, discount_amount, final_amount, notes, created_at`,
        [cafeId, customer_name, customer_phone || null, tableNum, order_type,
         total, discountAmount, finalAmount, offerId || null, notes || null, client_order_id || null]
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
        if (newQty <= 0 && req.io) {
          req.io.to(`cafe:${cafeId}`).emit('item_sold_out', { menu_item_id: i.menu_item_id, name: mi.name });
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

    if (req.io) {
      req.io.to(`cafe:${cafeId}`).emit('new_order', fullOrder);
    }

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
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200); // cap at 200
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
              o.order_type, o.status,
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
        'SELECT id, order_id, menu_item_id, item_name, quantity, unit_price, subtotal FROM order_items WHERE order_id = ANY($1)',
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

  // Fetch current status for audit log before updating
  const currentRow = await db.query(
    'SELECT status FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, req.cafeId]
  );
  if (currentRow.rows.length === 0) return fail(res, 'Order not found', 404);
  const fromStatus = currentRow.rows[0].status;

  const result = await db.query(
    `UPDATE orders SET ${setClauses.join(', ')}
     WHERE id = $${idIdx} AND cafe_id = $${cafeIdx}
     RETURNING id, order_number,
               COALESCE(daily_order_number, order_number) AS daily_order_number,
               customer_name, table_number, order_type, status,
               total_amount, cash_received, change_amount,
               cancellation_reason, updated_at`,
    params
  );
  if (result.rows.length === 0) return fail(res, 'Order not found', 404);

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
              o.notes, o.created_at, o.updated_at
       FROM orders o WHERE o.id = $1${cafeFilter}`,
      params
    ),
    db.query(
      'SELECT id, menu_item_id, item_name, quantity, unit_price, subtotal FROM order_items WHERE order_id = $1',
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
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature) {
    logger.warn('Invalid Razorpay signature for food order %s', id);
    return fail(res, 'Payment verification failed', 400);
  }

  // Fetch order and validate
  const result = await db.query(
    `SELECT o.id, o.status, o.payment_order_id, o.payment_verified, o.cafe_id,
            COALESCE(o.daily_order_number, o.order_number) AS daily_order_number,
            o.table_number, o.order_type
     FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND c.slug = $2`,
    [id, slug]
  );

  if (result.rows.length === 0) return fail(res, 'Order not found', 404);
  const order = result.rows[0];

  if (order.payment_verified) return fail(res, 'Already paid', 409);
  if (order.payment_order_id !== razorpay_order_id) {
    return fail(res, 'Order ID mismatch', 400);
  }

  // Mark paid
  const updated = await db.query(
    `UPDATE orders
     SET status = 'paid', payment_id = $1, payment_verified = true, updated_at = NOW()
     WHERE id = $2
     RETURNING id, order_number,
               COALESCE(daily_order_number, order_number) AS daily_order_number,
               customer_name, table_number, order_type, status,
               total_amount, final_amount, updated_at`,
    [razorpay_payment_id, id]
  );
  const updatedOrder = updated.rows[0];

  // Emit to owner/kitchen via socket
  if (req.io) {
    req.io.to(`cafe:${order.cafe_id}`).emit('order_updated', updatedOrder);
    req.io.to(`order:${id}`).emit('order_updated', updatedOrder);
  }

  logger.info('Food payment verified: order %s cafe %s amount paid', id, slug);
  ok(res, { order: updatedOrder }, 'Payment successful!');
});
