const db = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// All date/time comparisons run in Asia/Kolkata so an offer ending "today"
// stays valid until midnight IST regardless of server timezone.
const TZ = 'Asia/Kolkata';
function nowIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const wkMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    today:     `${get('year')}-${get('month')}-${get('day')}`,
    timeStr:   `${get('hour')}:${get('minute')}`,
    dayOfWeek: wkMap[get('weekday')],
  };
}

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
    start_date, end_date, max_uses, max_discount_amount,
    bogo_item_id,
  } = req.body;

  if (!name?.trim()) return fail(res, 'Offer name is required');
  if (!['percentage', 'fixed', 'combo', 'bogo', 'first_order'].includes(offer_type))
    return fail(res, 'Invalid offer_type');

  const normalizedCoupon    = coupon_code?.trim().toUpperCase() || null;
  const parsedDiscount      = parseFloat(discount_value);
  const parsedComboPrice    = parseFloat(combo_price);
  const parsedMinOrder      = parseFloat(min_order_amount) || 0;
  const parsedMaxDiscount   = max_discount_amount ? parseFloat(max_discount_amount) : null;

  if (offer_type === 'percentage') {
    if (Number.isNaN(parsedDiscount) || parsedDiscount < 1 || parsedDiscount > 100)
      return fail(res, 'Percentage discount must be 1–100');
  } else if (offer_type === 'fixed') {
    if (Number.isNaN(parsedDiscount) || parsedDiscount <= 0)
      return fail(res, 'Fixed discount must be a positive number');
  } else if (offer_type === 'combo') {
    if (!Array.isArray(combo_items) || combo_items.length < 2)
      return fail(res, 'Select at least 2 items for a combo offer');
    if (Number.isNaN(parsedComboPrice) || parsedComboPrice <= 0)
      return fail(res, 'Combo price is required');
  } else if (offer_type === 'bogo') {
    if (!bogo_item_id)
      return fail(res, 'bogo_item_id is required for BOGO offers');
  }

  const result = await db.query(
    `INSERT INTO offers
       (cafe_id, name, description, offer_type, discount_value,
        combo_items, combo_price, min_order_amount,
        active_from, active_until, active_days, coupon_code,
        start_date, end_date, max_uses, max_discount_amount,
        bogo_item_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      req.cafeId, name.trim(), description || null, offer_type,
      offer_type === 'combo' ? 0 : (parsedDiscount || 0),
      offer_type === 'combo' ? JSON.stringify(combo_items) : null,
      offer_type === 'combo' ? parsedComboPrice : null,
      parsedMinOrder,
      active_from || null, active_until || null, active_days || null,
      normalizedCoupon,
      start_date || null, end_date || null,
      max_uses ? parseInt(max_uses) : null, parsedMaxDiscount,
      bogo_item_id || null,
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
    start_date, end_date, max_uses, max_discount_amount, bogo_item_id,
  } = req.body;

  const normalizedCoupon = coupon_code !== undefined
    ? (coupon_code?.trim().toUpperCase() || null)
    : undefined;

  const result = await db.query(
    `UPDATE offers SET
       name                = COALESCE($1,  name),
       description         = COALESCE($2,  description),
       offer_type          = COALESCE($3,  offer_type),
       discount_value      = COALESCE($4,  discount_value),
       combo_items         = COALESCE($5,  combo_items),
       combo_price         = COALESCE($6,  combo_price),
       min_order_amount    = COALESCE($7,  min_order_amount),
       active_from         = COALESCE($8,  active_from),
       active_until        = COALESCE($9,  active_until),
       active_days         = COALESCE($10, active_days),
       is_active           = COALESCE($11, is_active),
       coupon_code         = CASE WHEN $12::TEXT IS NOT NULL THEN $12::VARCHAR(30) ELSE coupon_code END,
       start_date          = COALESCE($13, start_date),
       end_date            = COALESCE($14, end_date),
       max_uses            = COALESCE($15, max_uses),
       max_discount_amount = COALESCE($16, max_discount_amount),
       bogo_item_id        = COALESCE($17, bogo_item_id)
     WHERE id = $18 AND cafe_id = $19
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
      start_date || null, end_date || null,
      max_uses != null ? parseInt(max_uses) : null,
      max_discount_amount != null ? parseFloat(max_discount_amount) : null,
      bogo_item_id || null,
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

// ─── Shared helpers ─────────────────────────────────────────────

function isScheduleActive(offer) {
  const { dayOfWeek, timeStr, today } = nowIST();

  if (offer.active_days && !offer.active_days.includes(dayOfWeek)) return false;
  if (offer.active_from  && timeStr < String(offer.active_from).slice(0, 5))  return false;
  if (offer.active_until && timeStr > String(offer.active_until).slice(0, 5)) return false;
  if (offer.start_date   && today < (typeof offer.start_date === 'string' ? offer.start_date : offer.start_date.toISOString().split('T')[0])) return false;
  if (offer.end_date     && today > (typeof offer.end_date   === 'string' ? offer.end_date   : offer.end_date.toISOString().split('T')[0])) return false;
  if (offer.max_uses != null && offer.uses_count >= offer.max_uses) return false;
  return true;
}

const calculateOfferDiscount = async (offer, items, total) => {
  if (!offer?.offer_type) return 0;
  total = parseFloat(total) || 0;

  let discount = 0;

  if (offer.offer_type === 'percentage') {
    discount = (total * parseFloat(offer.discount_value)) / 100;

  } else if (offer.offer_type === 'fixed') {
    discount = Math.min(parseFloat(offer.discount_value) || 0, total);

  } else if (offer.offer_type === 'first_order') {
    // first_order: discount_value is %, or use a fixed if type indicates
    discount = (total * parseFloat(offer.discount_value || 0)) / 100;

  } else if (offer.offer_type === 'bogo' && offer.bogo_item_id) {
    // BOGO: find the qualifying item in cart, give its price free
    const { rows } = await db.query(
      'SELECT price FROM menu_items WHERE id = $1 LIMIT 1',
      [offer.bogo_item_id]
    );
    const itemPrice = parseFloat(rows[0]?.price || 0);
    const qty = items.reduce((sum, i) =>
      i.menu_item_id === offer.bogo_item_id ? sum + i.quantity : sum, 0
    );
    // every 2 units → 1 free
    const freeUnits = Math.floor(qty / 2);
    discount = itemPrice * freeUnits;

  } else if (offer.offer_type === 'combo' && offer.combo_items && offer.combo_price) {
    const comboItems = typeof offer.combo_items === 'string'
      ? JSON.parse(offer.combo_items) : offer.combo_items;
    const orderItemMap = {};
    items.forEach((i) => { orderItemMap[i.menu_item_id] = (orderItemMap[i.menu_item_id] || 0) + i.quantity; });
    const comboMatches = comboItems.every(
      (ci) => (orderItemMap[ci.menu_item_id] || 0) >= ci.quantity
    );
    if (!comboMatches) return 0;

    const comboItemIds = comboItems.map((ci) => ci.menu_item_id);
    const { rows: menuPrices } = await db.query(
      'SELECT id, price FROM menu_items WHERE id = ANY($1)', [comboItemIds]
    );
    const priceMap = {};
    menuPrices.forEach((r) => { priceMap[r.id] = parseFloat(r.price) || 0; });
    const normalTotal = comboItems.reduce((s, ci) => s + (priceMap[ci.menu_item_id] || 0) * ci.quantity, 0);
    discount = Math.max(normalTotal - parseFloat(offer.combo_price), 0);
  }

  // Apply max_discount_amount cap if set
  if (offer.max_discount_amount) {
    discount = Math.min(discount, parseFloat(offer.max_discount_amount));
  }

  return parseFloat(Math.max(0, Math.min(discount, total)).toFixed(2));
};

// ─── Fetch active platform offers applicable to a café ───────────
async function getActivePlatformOffers(cafeId, total) {
  const { dayOfWeek, timeStr, today } = nowIST();

  const { rows } = await db.query(
    `SELECT po.*
     FROM platform_offers po
     WHERE po.is_active = true
       AND po.min_order_amount <= $1
       AND (po.start_date IS NULL OR po.start_date <= $2)
       AND (po.end_date   IS NULL OR po.end_date   >= $2)
       AND (po.max_uses   IS NULL OR po.uses_count < po.max_uses)
       AND (po.active_days  IS NULL OR $3 = ANY(po.active_days))
       AND (po.active_from  IS NULL OR po.active_from  <= $4::TIME)
       AND (po.active_until IS NULL OR po.active_until >= $4::TIME)
       AND (
         po.target_type = 'all'
         OR EXISTS (
           SELECT 1 FROM platform_offer_cafes poc
           WHERE poc.platform_offer_id = po.id AND poc.cafe_id = $5
         )
       )`,
    [total, today, dayOfWeek, timeStr, cafeId]
  );
  return rows;
}

// ─── Public: get active offers for a café (customer menu) ────────
exports.getPublicOffers = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const cafeResult = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 AND is_active = true', [slug]
  );
  if (!cafeResult.rows.length) return fail(res, 'Café not found', 404);
  const cafeId = cafeResult.rows[0].id;

  const { dayOfWeek, timeStr, today } = nowIST();

  const [ownerOffers, platformOffers] = await Promise.all([
    db.query(
      `SELECT id, name, description, offer_type, discount_value,
              combo_items, combo_price, min_order_amount,
              active_from, active_until, active_days,
              start_date, end_date, max_uses, uses_count, max_discount_amount,
              bogo_item_id, coupon_code,
              'owner' AS funded_by
       FROM offers
       WHERE cafe_id = $1 AND is_active = true
         AND (active_days IS NULL OR $2 = ANY(active_days))
         AND (active_from IS NULL OR active_from <= $3::TIME)
         AND (active_until IS NULL OR active_until >= $3::TIME)
         AND (start_date IS NULL OR start_date <= $4)
         AND (end_date   IS NULL OR end_date   >= $4)
         AND (max_uses   IS NULL OR uses_count < max_uses)
       ORDER BY offer_type, discount_value DESC`,
      [cafeId, dayOfWeek, timeStr, today]
    ),
    db.query(
      `SELECT po.id, po.name, po.description, po.offer_type, po.discount_value,
              po.min_order_amount, po.max_discount_amount, po.coupon_code,
              po.active_from, po.active_until, po.active_days,
              po.start_date, po.end_date, po.max_uses, po.uses_count,
              'platform' AS funded_by
       FROM platform_offers po
       WHERE po.is_active = true
         AND (po.start_date IS NULL OR po.start_date <= $1)
         AND (po.end_date   IS NULL OR po.end_date   >= $1)
         AND (po.max_uses   IS NULL OR po.uses_count < po.max_uses)
         AND (po.active_days  IS NULL OR $2 = ANY(po.active_days))
         AND (po.active_from  IS NULL OR po.active_from  <= $3::TIME)
         AND (po.active_until IS NULL OR po.active_until >= $3::TIME)
         AND (
           po.target_type = 'all'
           OR EXISTS (SELECT 1 FROM platform_offer_cafes poc
                      WHERE poc.platform_offer_id = po.id AND poc.cafe_id = $4)
         )
       ORDER BY po.discount_value DESC`,
      [today, dayOfWeek, timeStr, cafeId]
    ),
  ]);

  ok(res, { offers: [...ownerOffers.rows, ...platformOffers.rows] });
});

// ─── Public: preview offer discount before placing order ─────────
exports.previewOffer = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { items = [], total = 0, customer_phone } = req.body;

  const cafeResult = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 AND is_active = true', [slug]
  );
  if (!cafeResult.rows.length) return fail(res, 'Café not found', 404);
  const cafeId = cafeResult.rows[0].id;

  const orderTotal = parseFloat(total) || 0;
  const result = await exports.applyBestOffer(cafeId, items, orderTotal, customer_phone || null);

  const { dayOfWeek, timeStr, today } = nowIST();

  // Near-miss: cheapest owner offer within 50% above total
  const { rows: nearMissRows } = await db.query(
    `SELECT name, offer_type, discount_value, coupon_code, min_order_amount
     FROM offers
     WHERE cafe_id = $1 AND is_active = true
       AND min_order_amount > $2 AND min_order_amount <= $2 * 1.5
       AND (active_days IS NULL OR $3 = ANY(active_days))
       AND (active_from  IS NULL OR active_from  <= $4::TIME)
       AND (active_until IS NULL OR active_until >= $4::TIME)
       AND (start_date IS NULL OR start_date <= $5)
       AND (end_date   IS NULL OR end_date   >= $5)
       AND (max_uses   IS NULL OR uses_count < max_uses)
     ORDER BY min_order_amount ASC LIMIT 1`,
    [cafeId, orderTotal, dayOfWeek, timeStr, today]
  );
  const nearMiss = nearMissRows[0] ? {
    offer_name:       nearMissRows[0].name,
    offer_type:       nearMissRows[0].offer_type,
    discount_value:   nearMissRows[0].discount_value,
    coupon_code:      nearMissRows[0].coupon_code,
    min_order_amount: parseFloat(nearMissRows[0].min_order_amount),
    amount_needed:    parseFloat((parseFloat(nearMissRows[0].min_order_amount) - orderTotal).toFixed(2)),
  } : null;

  if (!result.offerId && !result.platformOfferId) {
    return ok(res, { applied: false, discount_amount: 0, final_amount: orderTotal, near_miss: nearMiss });
  }

  const offerRow = result.fundedBy === 'platform'
    ? await db.query('SELECT name, description, offer_type, discount_value FROM platform_offers WHERE id = $1', [result.platformOfferId])
    : await db.query('SELECT name, description, offer_type, discount_value FROM offers WHERE id = $1', [result.offerId]);

  ok(res, {
    applied:          true,
    funded_by:        result.fundedBy,
    offer_name:       offerRow.rows[0]?.name,
    offer_type:       offerRow.rows[0]?.offer_type,
    discount_value:   offerRow.rows[0]?.discount_value,
    discount_amount:  result.discountAmount,
    final_amount:     result.finalAmount,
    near_miss:        null,
  });
});

// ─── Public: validate a coupon code ──────────────────────────────
exports.validateCoupon = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { coupon_code, items = [], total = 0 } = req.body;

  if (!coupon_code?.trim()) return fail(res, 'Coupon code is required', 400);

  const cafeResult = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 AND is_active = true', [slug]
  );
  if (!cafeResult.rows.length) return fail(res, 'Café not found', 404);
  const cafeId = cafeResult.rows[0].id;

  const orderTotal = parseFloat(total) || 0;
  const { dayOfWeek, timeStr, today } = nowIST();
  const code       = coupon_code.trim().toUpperCase();

  // Check owner offers first
  const { rows: ownerFound } = await db.query(
    `SELECT * FROM offers
     WHERE cafe_id = $1 AND is_active = true AND UPPER(coupon_code) = $2
     LIMIT 1`,
    [cafeId, code]
  );

  // Then check platform offers
  const { rows: platformFound } = await db.query(
    `SELECT po.* FROM platform_offers po
     WHERE po.is_active = true AND UPPER(po.coupon_code) = $1
       AND (po.target_type = 'all' OR EXISTS (
         SELECT 1 FROM platform_offer_cafes poc
         WHERE poc.platform_offer_id = po.id AND poc.cafe_id = $2
       ))
     LIMIT 1`,
    [code, cafeId]
  );

  const offer      = ownerFound[0] || platformFound[0];
  const fundedBy   = ownerFound[0] ? 'owner' : 'platform';
  if (!offer) return fail(res, 'Invalid coupon code', 400);

  if (parseFloat(offer.min_order_amount) > orderTotal) {
    const need = (parseFloat(offer.min_order_amount) - orderTotal).toFixed(0);
    return fail(res, `Add ₹${need} more to use this coupon (min order ₹${parseFloat(offer.min_order_amount).toFixed(0)})`, 400);
  }

  // Schedule checks
  if (!isScheduleActive({ ...offer, uses_count: offer.uses_count ?? 0 })) {
    return fail(res, 'This coupon is not valid right now', 400);
  }

  // For first_order: verify customer has no prior paid orders at this cafe
  if (offer.offer_type === 'first_order' && req.body.customer_phone) {
    const { rows: prevOrders } = await db.query(
      `SELECT id FROM orders WHERE cafe_id = $1 AND customer_phone = $2 AND status = 'paid' LIMIT 1`,
      [cafeId, req.body.customer_phone]
    );
    if (prevOrders.length > 0) return fail(res, 'This offer is for first-time customers only', 400);
  }

  const discountAmount = await calculateOfferDiscount(offer, items, orderTotal);
  if (discountAmount <= 0) {
    return fail(res, offer.offer_type === 'combo'
      ? 'This coupon requires the matching combo items in your cart'
      : offer.offer_type === 'bogo'
      ? 'Add the qualifying item to your cart to use this BOGO offer'
      : 'This coupon cannot be applied to this order', 400);
  }

  ok(res, {
    applied:          true,
    funded_by:        fundedBy,
    offer_id:         fundedBy === 'owner' ? offer.id : null,
    platform_offer_id: fundedBy === 'platform' ? offer.id : null,
    offer_name:       offer.name,
    offer_type:       offer.offer_type,
    discount_value:   offer.discount_value,
    discount_amount:  discountAmount,
    final_amount:     Math.max(0, parseFloat((orderTotal - discountAmount).toFixed(2))),
  });
});

// ─── Helper: apply best offer (owner + platform) to an order ─────
// Returns { offerId, platformOfferId, fundedBy, discountAmount, finalAmount }
exports.applyBestOffer = async (cafeId, items, total, customerPhone = null) => {
  const { dayOfWeek, timeStr, today } = nowIST();

  const [ownerRes, platformRes] = await Promise.all([
    db.query(
      `SELECT * FROM offers
       WHERE cafe_id = $1 AND is_active = true
         AND min_order_amount <= $2
         AND coupon_code IS NULL
         AND (active_days IS NULL OR $3 = ANY(active_days))
         AND (active_from  IS NULL OR active_from  <= $4::TIME)
         AND (active_until IS NULL OR active_until >= $4::TIME)
         AND (start_date IS NULL OR start_date <= $5)
         AND (end_date   IS NULL OR end_date   >= $5)
         AND (max_uses   IS NULL OR uses_count < max_uses)`,
      [cafeId, total, dayOfWeek, timeStr, today]
    ),
    getActivePlatformOffers(cafeId, total),
  ]);

  const allOffers = [
    ...ownerRes.rows.map((o) => ({ ...o, _fundedBy: 'owner' })),
    ...platformRes.filter((o) => !o.coupon_code).map((o) => ({ ...o, _fundedBy: 'platform' })),
  ];

  if (allOffers.length === 0) return { offerId: null, platformOfferId: null, fundedBy: null, discountAmount: 0, finalAmount: total };

  // Pre-check: if any first_order offer is in play and we have a phone, see if customer is repeat
  let hasPriorOrder = false;
  if (customerPhone && allOffers.some((o) => o.offer_type === 'first_order')) {
    const { rows } = await db.query(
      `SELECT 1 FROM orders WHERE cafe_id = $1 AND customer_phone = $2 AND status = 'paid' LIMIT 1`,
      [cafeId, customerPhone]
    );
    hasPriorOrder = rows.length > 0;
  }

  let bestDiscount = 0;
  let bestOffer    = null;

  for (const offer of allOffers) {
    // Skip first_order offers for repeat customers (only when phone is provided)
    if (offer.offer_type === 'first_order' && customerPhone && hasPriorOrder) continue;
    const discount = await calculateOfferDiscount(offer, items, total);
    if (discount > bestDiscount) {
      bestDiscount = discount;
      bestOffer    = offer;
    }
  }

  const discountAmount = Math.min(bestDiscount, total);
  const fundedBy       = bestOffer?._fundedBy || null;
  return {
    offerId:          fundedBy === 'owner' ? bestOffer?.id : null,
    platformOfferId:  fundedBy === 'platform' ? bestOffer?.id : null,
    fundedBy,
    discountAmount:   parseFloat(discountAmount.toFixed(2)),
    finalAmount:      parseFloat((total - discountAmount).toFixed(2)),
  };
};

// ─── Helper: apply a specific coupon code ────────────────────────
exports.applyCoupon = async (cafeId, couponCode, items, total, customerPhone) => {
  const { dayOfWeek, timeStr, today } = nowIST();
  const code = couponCode.trim().toUpperCase();

  // Check owner coupon
  const { rows: ownerRows } = await db.query(
    `SELECT * FROM offers
     WHERE cafe_id = $1 AND is_active = true
       AND UPPER(coupon_code) = $2
       AND min_order_amount <= $3
       AND (active_days IS NULL OR $4 = ANY(active_days))
       AND (active_from  IS NULL OR active_from  <= $5::TIME)
       AND (active_until IS NULL OR active_until >= $5::TIME)
       AND (start_date IS NULL OR start_date <= $6)
       AND (end_date   IS NULL OR end_date   >= $6)
       AND (max_uses   IS NULL OR uses_count < max_uses)
     LIMIT 1`,
    [cafeId, code, parseFloat(total) || 0, dayOfWeek, timeStr, today]
  );

  // Check platform coupon
  const { rows: platformRows } = await db.query(
    `SELECT po.* FROM platform_offers po
     WHERE po.is_active = true AND UPPER(po.coupon_code) = $1
       AND po.min_order_amount <= $2
       AND (po.active_days  IS NULL OR $3 = ANY(po.active_days))
       AND (po.active_from  IS NULL OR po.active_from  <= $4::TIME)
       AND (po.active_until IS NULL OR po.active_until >= $4::TIME)
       AND (po.start_date IS NULL OR po.start_date <= $5)
       AND (po.end_date   IS NULL OR po.end_date   >= $5)
       AND (po.max_uses   IS NULL OR po.uses_count < po.max_uses)
       AND (po.target_type = 'all' OR EXISTS (
         SELECT 1 FROM platform_offer_cafes poc
         WHERE poc.platform_offer_id = po.id AND poc.cafe_id = $6
       ))
     LIMIT 1`,
    [code, parseFloat(total) || 0, dayOfWeek, timeStr, today, cafeId]
  );

  const offer    = ownerRows[0] || platformRows[0];
  const fundedBy = ownerRows[0] ? 'owner' : 'platform';
  if (!offer) return { offerId: null, platformOfferId: null, fundedBy: null, discountAmount: 0, finalAmount: total };

  // First-order check
  if (offer.offer_type === 'first_order' && customerPhone) {
    const { rows: prev } = await db.query(
      `SELECT id FROM orders WHERE cafe_id = $1 AND customer_phone = $2 AND status = 'paid' LIMIT 1`,
      [cafeId, customerPhone]
    );
    if (prev.length > 0) return { offerId: null, platformOfferId: null, fundedBy: null, discountAmount: 0, finalAmount: total };
  }

  const discountAmount = await calculateOfferDiscount(offer, items, total);
  if (discountAmount <= 0) return { offerId: null, platformOfferId: null, fundedBy: null, discountAmount: 0, finalAmount: total };

  return {
    offerId:         fundedBy === 'owner' ? offer.id : null,
    platformOfferId: fundedBy === 'platform' ? offer.id : null,
    fundedBy,
    discountAmount,
    finalAmount: parseFloat((total - discountAmount).toFixed(2)),
  };
};
