/**
 * Aggregator Integration — Zomato / Swiggy via UrbanPiper, and ONDC
 *
 * How to activate:
 * 1. Sign up at https://urbanpiper.com as a merchant partner
 * 2. Set env vars: URBANPIPER_API_KEY, URBANPIPER_USERNAME, URBANPIPER_BIZ_ID
 * 3. Give UrbanPiper this webhook URL: POST /api/aggregator/urbanpiper/order
 * 4. For ONDC: complete NP registration at https://ondc.org, then set ONDC_SUBSCRIBER_ID
 *
 * All order payloads are normalized into DineVerse's internal order format
 * and inserted via the same createOrder flow so kitchen/analytics work unchanged.
 */

const db      = require('../config/database');
const logger  = require('../utils/logger');
const { ok, fail } = require('../utils/respond');
const asyncHandler  = require('../utils/asyncHandler');
const { getOrderWithItems } = require('./orderController');

// ─── UrbanPiper (Zomato + Swiggy) ────────────────────────────────

// Normalize UrbanPiper order payload → DineVerse order shape
function normalizeUrbanPiperOrder(payload, cafeId) {
  const src    = payload.order || payload;
  const items  = (src.items || []).map((i) => ({
    menu_item_id: i.merchant_id,   // must match menu_items.id in your DB
    item_name:    i.title,
    quantity:     parseInt(i.quantity) || 1,
    unit_price:   parseFloat(i.price) / 100, // UP sends paise
  }));

  return {
    cafe_id:         cafeId,
    customer_name:   src.customer?.name || 'Online Customer',
    customer_phone:  src.customer?.phone || null,
    order_type:      'delivery',
    table_number:    null,
    notes:           src.instructions || null,
    total_amount:    parseFloat(src.order_subtotal) / 100,
    final_amount:    parseFloat(src.order_total)    / 100,
    delivery_fee:    parseFloat(src.delivery_charge || 0) / 100,
    source:          src.channel || 'aggregator', // 'zomato' | 'swiggy'
    external_order_id: src.id,
    items,
  };
}

// Verify UrbanPiper webhook signature (HMAC-SHA256 of raw body)
function verifyUrbanPiperSignature(rawBody, signature) {
  const apiKey = process.env.URBANPIPER_API_KEY;
  if (!apiKey) return true; // skip in dev if key not set
  const expected = require('crypto')
    .createHmac('sha256', apiKey)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

// POST /api/aggregator/urbanpiper/order
exports.urbanPiperOrder = asyncHandler(async (req, res) => {
  const sig = req.headers['x-urbanpiper-signature'] || '';
  if (!verifyUrbanPiperSignature(req.rawBody || JSON.stringify(req.body), sig)) {
    return fail(res, 'Invalid signature', 401);
  }

  const bizId = req.body?.store?.biz_location_id || req.body?.order?.store?.biz_location_id;
  if (!bizId) return fail(res, 'Missing store ID', 400);

  // Look up café by UrbanPiper biz_location_id stored in cafe settings
  const cafeRes = await db.query(
    `SELECT id, name FROM cafes WHERE settings->>'urbanpiper_biz_id' = $1 AND is_active = true`,
    [String(bizId)]
  );
  if (!cafeRes.rows.length) return fail(res, 'Store not linked', 404);
  const cafeId = cafeRes.rows[0].id;

  const normalized = normalizeUrbanPiperOrder(req.body, cafeId);

  // Deduplicate by external_order_id
  const existing = await db.query(
    `SELECT id FROM orders WHERE cafe_id = $1 AND external_order_id = $2`,
    [cafeId, normalized.external_order_id]
  );
  if (existing.rows.length) {
    return ok(res, { order_id: existing.rows[0].id }, 'Order already exists');
  }

  // Insert order (simplified — no offer/coupon logic for aggregator orders)
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(
      `INSERT INTO orders
         (cafe_id, customer_name, customer_phone, order_type, table_number, notes,
          total_amount, final_amount, delivery_fee, status, external_order_id, accepted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,false)
       RETURNING id`,
      [cafeId, normalized.customer_name, normalized.customer_phone, 'delivery', null,
       normalized.notes, normalized.total_amount, normalized.final_amount,
       normalized.delivery_fee, normalized.external_order_id]
    );
    const orderId = orderRes.rows[0].id;

    for (const item of normalized.items) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, unit_price)
         VALUES ($1, $2::uuid, $3, $4, $5)`,
        [orderId, item.menu_item_id, item.item_name, item.quantity, item.unit_price]
      );
    }

    await client.query('COMMIT');
    const fullOrder = await getOrderWithItems(orderId);
    req.io?.to(`cafe:${cafeId}`).emit('new_order', fullOrder);
    logger.info('UrbanPiper order %s inserted for café %s', normalized.external_order_id, cafeId);
    ok(res, { order_id: orderId }, 'Order received', 201);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/aggregator/urbanpiper/menu-ack — UrbanPiper confirms menu push succeeded
exports.urbanPiperMenuAck = asyncHandler(async (req, res) => {
  logger.info('UrbanPiper menu ack: %j', req.body);
  ok(res, {}, 'Acknowledged');
});

// GET /api/aggregator/urbanpiper/menu/:slug — UrbanPiper pulls menu for sync
exports.urbanPiperMenuPull = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const cafeRes = await db.query(
    `SELECT c.id, c.name FROM cafes c WHERE c.slug = $1 AND c.is_active = true`,
    [slug]
  );
  if (!cafeRes.rows.length) return fail(res, 'Café not found', 404);
  const cafeId = cafeRes.rows[0].id;

  const [cats, items] = await Promise.all([
    db.query('SELECT id, name FROM categories WHERE cafe_id = $1 ORDER BY display_order', [cafeId]),
    db.query(
      `SELECT id, category_id, name, description, price, is_veg, is_available, image_url
       FROM menu_items WHERE cafe_id = $1`,
      [cafeId]
    ),
  ]);

  // UrbanPiper catalog format
  const catalog = cats.rows.map((cat) => ({
    ref_id:  cat.id,
    name:    cat.name,
    items: items.rows
      .filter((i) => i.category_id === cat.id)
      .map((i) => ({
        ref_id:      i.id,
        name:        i.name,
        description: i.description || '',
        price:       Math.round(parseFloat(i.price) * 100), // paise
        food_type:   i.is_veg ? 'veg' : 'non-veg',
        available:   i.is_available,
        img_url:     i.image_url || '',
      })),
  }));

  ok(res, { catalog });
});

// ─── ONDC (Open Network for Digital Commerce) ────────────────────
// ONDC uses a beckn protocol. Full implementation requires NP registration.
// This stub handles the on_search / on_select / on_init / on_confirm flow.

exports.ondcSearch = asyncHandler(async (req, res) => {
  // Acknowledge immediately; async callback via ONDC network
  ok(res, { message: { ack: { status: 'ACK' } } });
  logger.info('ONDC search received: %s', req.body?.context?.transaction_id);
});

exports.ondcConfirm = asyncHandler(async (req, res) => {
  ok(res, { message: { ack: { status: 'ACK' } } });
  logger.info('ONDC confirm received: %s', req.body?.context?.transaction_id);
  // TODO: parse beckn order format → normalized → insert order (same as UrbanPiper flow)
});

exports.ondcStatus = asyncHandler(async (req, res) => {
  ok(res, { message: { ack: { status: 'ACK' } } });
});

exports.ondcCancel = asyncHandler(async (req, res) => {
  ok(res, { message: { ack: { status: 'ACK' } } });
  logger.info('ONDC cancel received: %s', req.body?.context?.transaction_id);
});
