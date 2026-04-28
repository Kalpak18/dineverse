const db = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// ─── Owner: CRUD for offers ───────────────────────────────────

exports.getOffers = asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT * FROM offers WHERE cafe_id = $1 ORDER BY created_at DESC',
    [req.cafeId]
  );
  ok(res, { offers: result.rows });
});

exports.createOffer = asyncHandler(async (req, res) => {
  const {
    name, description, offer_type, discount_value,
    combo_items, combo_price, min_order_amount,
    active_from, active_until, active_days, coupon_code,
  } = req.body;

  if (!name?.trim()) return fail(res, 'Offer name is required');
  if (!['percentage', 'fixed', 'combo'].includes(offer_type))
    return fail(res, 'offer_type must be percentage, fixed, or combo');
  if (offer_type === 'percentage' && (discount_value < 1 || discount_value > 100))
    return fail(res, 'Percentage discount must be between 1 and 100');
  if (offer_type === 'combo' && !combo_price)
    return fail(res, 'combo_price is required for combo offers');

  const normalizedCoupon = coupon_code?.trim().toUpperCase() || null;

  const result = await db.query(
    `INSERT INTO offers
       (cafe_id, name, description, offer_type, discount_value,
        combo_items, combo_price, min_order_amount,
        active_from, active_until, active_days, coupon_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      req.cafeId, name.trim(), description || null, offer_type,
      parseFloat(discount_value) || 0,
      combo_items ? JSON.stringify(combo_items) : null,
      combo_price ? parseFloat(combo_price) : null,
      parseFloat(min_order_amount) || 0,
      active_from || null, active_until || null,
      active_days || null, normalizedCoupon,
    ]
  );
  ok(res, { offer: result.rows[0] }, 'Offer created', 201);
});

exports.updateOffer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name, description, offer_type, discount_value,
    combo_items, combo_price, min_order_amount,
    active_from, active_until, active_days, is_active, coupon_code,
  } = req.body;

  const normalizedCoupon = coupon_code !== undefined
    ? (coupon_code?.trim().toUpperCase() || null)
    : undefined;

  const result = await db.query(
    `UPDATE offers SET
       name             = COALESCE($1,  name),
       description      = COALESCE($2,  description),
       offer_type       = COALESCE($3,  offer_type),
       discount_value   = COALESCE($4,  discount_value),
       combo_items      = COALESCE($5,  combo_items),
       combo_price      = COALESCE($6,  combo_price),
       min_order_amount = COALESCE($7,  min_order_amount),
       active_from      = COALESCE($8,  active_from),
       active_until     = COALESCE($9,  active_until),
       active_days      = COALESCE($10, active_days),
       is_active        = COALESCE($11, is_active),
       coupon_code      = CASE WHEN $12::TEXT IS NOT NULL THEN $12::VARCHAR(30) ELSE coupon_code END
     WHERE id = $13 AND cafe_id = $14
     RETURNING *`,
    [
      name || null, description || null, offer_type || null,
      discount_value != null ? parseFloat(discount_value) : null,
      combo_items != null ? JSON.stringify(combo_items) : null,
      combo_price != null ? parseFloat(combo_price) : null,
      min_order_amount != null ? parseFloat(min_order_amount) : null,
      active_from || null, active_until || null, active_days || null,
      is_active != null ? is_active : null,
      normalizedCoupon !== undefined ? normalizedCoupon : null,
      id, req.cafeId,
    ]
  );
  if (result.rows.length === 0) return fail(res, 'Offer not found', 404);
  ok(res, { offer: result.rows[0] });
});

exports.deleteOffer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    'DELETE FROM offers WHERE id = $1 AND cafe_id = $2 RETURNING id',
    [id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Offer not found', 404);
  ok(res, {}, 'Offer deleted');
});

// ─── Public: get active offers for a café (for customer menu) ─
exports.getPublicOffers = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const cafeResult = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 AND is_active = true',
    [slug]
  );
  if (cafeResult.rows.length === 0) return fail(res, 'Café not found', 404);

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun … 6=Sat
  const timeStr = now.toTimeString().slice(0, 5); // "HH:MM"

  const result = await db.query(
    `SELECT id, name, description, offer_type, discount_value,
            combo_items, combo_price, min_order_amount,
            active_from, active_until, active_days
     FROM offers
     WHERE cafe_id = $1 AND is_active = true
       AND (active_days IS NULL OR $2 = ANY(active_days))
       AND (active_from IS NULL OR active_from <= $3::TIME)
       AND (active_until IS NULL OR active_until >= $3::TIME)
     ORDER BY offer_type, discount_value DESC`,
    [cafeResult.rows[0].id, dayOfWeek, timeStr]
  );
  ok(res, { offers: result.rows });
});

// ─── Public: preview offer discount before placing order ────────
// POST /offers/cafe/:slug/preview  { items: [{menu_item_id, quantity}], total }
exports.previewOffer = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { items = [], total = 0 } = req.body;

  const cafeResult = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 AND is_active = true',
    [slug]
  );
  if (cafeResult.rows.length === 0) return fail(res, 'Café not found', 404);

  const { offerId, discountAmount, finalAmount } = await exports.applyBestOffer(
    cafeResult.rows[0].id, items, parseFloat(total) || 0
  );

  const orderTotal = parseFloat(total) || 0;
  const cafeId = cafeResult.rows[0].id;

  // Near-miss: find the cheapest unapplied offer within 50% above current total
  const now2 = new Date();
  const { rows: nearMissRows } = await db.query(
    `SELECT name, offer_type, discount_value, coupon_code, min_order_amount
     FROM offers
     WHERE cafe_id = $1 AND is_active = true
       AND min_order_amount > $2
       AND min_order_amount <= $2 * 1.5
       AND (active_days IS NULL OR $3 = ANY(active_days))
       AND (active_from IS NULL OR active_from <= $4::TIME)
       AND (active_until IS NULL OR active_until >= $4::TIME)
     ORDER BY min_order_amount ASC
     LIMIT 1`,
    [cafeId, orderTotal, now2.getDay(), now2.toTimeString().slice(0, 5)]
  );
  const nearMiss = nearMissRows[0]
    ? {
        offer_name:       nearMissRows[0].name,
        offer_type:       nearMissRows[0].offer_type,
        discount_value:   nearMissRows[0].discount_value,
        coupon_code:      nearMissRows[0].coupon_code,
        min_order_amount: parseFloat(nearMissRows[0].min_order_amount),
        amount_needed:    parseFloat((parseFloat(nearMissRows[0].min_order_amount) - orderTotal).toFixed(2)),
      }
    : null;

  if (!offerId) return ok(res, { applied: false, discount_amount: 0, final_amount: orderTotal, near_miss: nearMiss });

  const offerRow = await db.query('SELECT name, description, offer_type, discount_value FROM offers WHERE id = $1', [offerId]);
  ok(res, {
    applied: true,
    offer_name:      offerRow.rows[0]?.name,
    offer_type:      offerRow.rows[0]?.offer_type,
    discount_value:  offerRow.rows[0]?.discount_value,
    discount_amount: discountAmount,
    final_amount:    finalAmount,
    near_miss:       null,
  });
});

// ─── Public: validate a coupon code ─────────────────────────────
// POST /offers/cafe/:slug/validate-coupon  { coupon_code, items, total }
exports.validateCoupon = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { coupon_code, total = 0 } = req.body;

  if (!coupon_code?.trim()) return fail(res, 'Coupon code is required', 400);

  const cafeResult = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 AND is_active = true',
    [slug]
  );
  if (cafeResult.rows.length === 0) return fail(res, 'Café not found', 404);
  const cafeId = cafeResult.rows[0].id;

  const orderTotal = parseFloat(total) || 0;
  const now        = new Date();
  const dayOfWeek  = now.getDay();
  const timeStr    = now.toTimeString().slice(0, 5);

  // Check if the coupon code exists (ignoring order amount / schedule),
  // so we can return a helpful "min order" hint vs "code not found".
  const { rows: found } = await db.query(
    `SELECT id, name, offer_type, discount_value, min_order_amount, active_days, active_from, active_until
     FROM offers
     WHERE cafe_id = $1 AND is_active = true AND UPPER(coupon_code) = $2
     LIMIT 1`,
    [cafeId, coupon_code.trim().toUpperCase()]
  );

  if (found.length === 0) {
    return fail(res, 'Invalid coupon code', 400);
  }

  const offer = found[0];

  // Minimum order check — give a helpful nudge
  if (parseFloat(offer.min_order_amount) > orderTotal) {
    const need = (parseFloat(offer.min_order_amount) - orderTotal).toFixed(0);
    return fail(res, `Add ₹${need} more to use this coupon (min order ₹${parseFloat(offer.min_order_amount).toFixed(0)})`, 400);
  }

  // Day / time restrictions
  const dayOk  = !offer.active_days  || offer.active_days.includes(dayOfWeek);
  const timeOk = (!offer.active_from  || timeStr >= String(offer.active_from).slice(0, 5))
              && (!offer.active_until || timeStr <= String(offer.active_until).slice(0, 5));

  if (!dayOk || !timeOk) {
    return fail(res, 'This coupon is not valid right now', 400);
  }

  // Calculate discount
  let discountAmount = 0;
  let finalAmount    = orderTotal;

  if (offer.offer_type === 'percentage') {
    discountAmount = parseFloat(((finalAmount * parseFloat(offer.discount_value)) / 100).toFixed(2));
    finalAmount    = parseFloat((finalAmount - discountAmount).toFixed(2));
  } else if (offer.offer_type === 'fixed') {
    discountAmount = Math.min(parseFloat(offer.discount_value), finalAmount);
    finalAmount    = parseFloat((finalAmount - discountAmount).toFixed(2));
  }

  ok(res, {
    applied:         true,
    offer_id:        offer.id,
    offer_name:      offer.name,
    offer_type:      offer.offer_type,
    discount_value:  offer.discount_value,
    discount_amount: discountAmount,
    final_amount:    Math.max(0, finalAmount),
  });
});

// ─── Helper: apply best offer to an order total ────────────────
// Returns { offerId, discountAmount, finalAmount }
exports.applyBestOffer = async (cafeId, items, total) => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const timeStr = now.toTimeString().slice(0, 5);

  const { rows: offers } = await db.query(
    `SELECT * FROM offers
     WHERE cafe_id = $1 AND is_active = true
       AND min_order_amount <= $2
       AND (active_days IS NULL OR $3 = ANY(active_days))
       AND (active_from IS NULL OR active_from <= $4::TIME)
       AND (active_until IS NULL OR active_until >= $4::TIME)`,
    [cafeId, total, dayOfWeek, timeStr]
  );

  if (offers.length === 0) return { offerId: null, discountAmount: 0, finalAmount: total };

  let bestDiscount = 0;
  let bestOffer = null;

  for (const offer of offers) {
    let discount = 0;
    if (offer.offer_type === 'percentage') {
      discount = (total * parseFloat(offer.discount_value)) / 100;
    } else if (offer.offer_type === 'fixed') {
      discount = parseFloat(offer.discount_value);
    } else if (offer.offer_type === 'combo' && offer.combo_items && offer.combo_price) {
      // Check if all combo items are present in the order
      const comboItems = typeof offer.combo_items === 'string'
        ? JSON.parse(offer.combo_items) : offer.combo_items;
      const orderItemMap = {};
      items.forEach((i) => { orderItemMap[i.menu_item_id] = (orderItemMap[i.menu_item_id] || 0) + i.quantity; });
      const comboMatches = comboItems.every(
        (ci) => (orderItemMap[ci.menu_item_id] || 0) >= ci.quantity
      );
      if (comboMatches) {
        // Calculate what combo items cost at normal price vs combo price
        discount = total - parseFloat(offer.combo_price);
        if (discount < 0) discount = 0;
      }
    }
    if (discount > bestDiscount) {
      bestDiscount = discount;
      bestOffer = offer;
    }
  }

  const discountAmount = Math.min(bestDiscount, total); // can't discount more than total
  return {
    offerId: bestOffer?.id || null,
    discountAmount: parseFloat(discountAmount.toFixed(2)),
    finalAmount: parseFloat((total - discountAmount).toFixed(2)),
  };
};
