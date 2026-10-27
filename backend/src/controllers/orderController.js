const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('../config/database');
const logger = require('../utils/logger');
const { ok, fail, validationFail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const { applyBestOffer, applyCoupon } = require('./offerController');
const { notify } = require('../services/notificationService');
const { sendToOwners } = require('./pushController');
const { generateOrderToken, hasOrderToken, sentOrderTokens, safeEqual } = require('../utils/orderToken');
const { refundPrepaidOrder } = require('../services/refundService');
const { geocodeAddress } = require('../services/geocodingService');

// Orders placed before migration 074 have no customer_token — let them
// through so in-flight customers aren't locked out; they age out in a day.
const canAccessOrder = (req, storedToken) => !storedToken || hasOrderToken(req, storedToken);

// Same label the customer app builds when a table is picked by hand
// ("5" → "Table 5"; area prefix unless it's the default area).
function canonicalTableLabel(label, areaName) {
  const t = String(label || '').trim();
  const normalized = /^\d+$/.test(t) ? `Table ${t}` : /^t\d+$/i.test(t) ? `Table ${t.slice(1)}` : t;
  if (areaName && areaName !== 'General' && !normalized.startsWith(areaName)) return `${areaName} — ${normalized}`;
  return normalized;
}

// A table's secret QR token → { id, label } (null if unknown/inactive)
async function tableFromQrToken(q, cafeId, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{32,128}$/i.test(token.trim())) return null;
  const r = await q.query(
    `SELECT t.id, t.label, a.name AS area_name
     FROM cafe_tables t LEFT JOIN areas a ON a.id = t.area_id
     WHERE t.qr_token = $1 AND t.cafe_id = $2 AND t.is_active = true`,
    [token.trim(), cafeId]
  );
  if (!r.rows.length) return null;
  return { id: r.rows[0].id, label: canonicalTableLabel(r.rows[0].label, r.rows[0].area_name) };
}

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

// Where a delivery goes and what it costs. GPS coordinates from the customer
// win; otherwise the typed address is geocoded. When the café has a location,
// a delivery location is mandatory — without it the radius check and per-km
// fee used to be silently skipped. Returns { error } or { fee, distanceKm, lat, lng }.
async function resolveDelivery(cafe, body) {
  const base = parseFloat(cafe.delivery_fee_base) || 0;
  const lat = parseFloat(body.delivery_lat);
  const lng = parseFloat(body.delivery_lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

  if (!cafe.latitude || !cafe.longitude) {
    // Café hasn't set its location — can't measure distance; flat fee
    return { fee: base, distanceKm: null, lat: hasCoords ? lat : null, lng: hasCoords ? lng : null };
  }

  let point = hasCoords ? { lat, lng } : null;
  if (!point) {
    const g = await geocodeAddress([
      body.delivery_address, body.delivery_address2, body.delivery_city, body.delivery_zipcode, 'India',
    ]);
    if (g) point = { lat: g.latitude, lng: g.longitude };
  }
  if (!point) {
    return { error: "We couldn't find that address on the map. Tap \"Use my current location\" or add your area, city and PIN code." };
  }

  const distKm = haversineKm(parseFloat(cafe.latitude), parseFloat(cafe.longitude), point.lat, point.lng);
  if (distKm > parseFloat(cafe.delivery_radius_km)) {
    return { error: `Delivery is only available within ${parseFloat(cafe.delivery_radius_km)} km of this café (you're about ${distKm.toFixed(1)} km away)` };
  }
  const fee = parseFloat((base + (parseFloat(cafe.delivery_fee_per_km) || 0) * distKm).toFixed(2));
  return { fee, distanceKm: parseFloat(distKm.toFixed(2)), lat: point.lat, lng: point.lng };
}

// ─── Public: delivery fee quote for the cart ──────────────────
// The cart shows this fee before the order is placed, then sends the returned
// lat/lng with the order so createOrder computes the identical fee.
exports.getDeliveryQuote = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const cafeRes = await db.query(
    `SELECT latitude, longitude,
            COALESCE(delivery_enabled, false)   AS delivery_enabled,
            COALESCE(delivery_radius_km, 5)     AS delivery_radius_km,
            COALESCE(delivery_fee_base, 0)      AS delivery_fee_base,
            COALESCE(delivery_fee_per_km, 0)    AS delivery_fee_per_km
     FROM cafes WHERE slug = $1 AND is_active = true`,
    [slug]
  );
  if (cafeRes.rows.length === 0) return fail(res, 'Café not found', 404);
  if (!cafeRes.rows[0].delivery_enabled) return fail(res, 'This café does not offer delivery', 400);

  const r = await resolveDelivery(cafeRes.rows[0], req.body || {});
  if (r.error) return fail(res, r.error, 400);
  ok(res, { delivery_fee: r.fee, distance_km: r.distanceKm, delivery_lat: r.lat, delivery_lng: r.lng });
});

exports.validateOrder = [
  body('customer_name').trim().notEmpty().withMessage('Your name is required'),
  body('order_type')
    .optional()
    .isIn(['dine-in', 'takeaway', 'delivery']).withMessage('order_type must be dine-in, takeaway, or delivery'),
  body('table_number')
    .if(body('order_type').not().equals('takeaway'))
    .if(body('order_type').not().equals('delivery'))
    .if((_, { req }) => !req.body.table_token) // a table QR scan names the table itself
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
    reservation_id,
    // delivery fields
    delivery_address, delivery_address2, delivery_city, delivery_zipcode,
    delivery_phone, delivery_lat, delivery_lng, delivery_instructions,
  } = req.body;
  const tip = Math.max(0, Math.min(parseFloat(tip_amount) || 0, 10000));
  // Dine-in table is provisional (typed by the customer) until resolved from a
  // table QR token below — only then is the order allowed onto a table bill.
  let tableNum = (order_type === 'takeaway' || order_type === 'delivery') ? (order_type === 'delivery' ? 'Delivery' : 'Takeaway') : (table_number || '');
  const isDineIn = order_type !== 'takeaway' && order_type !== 'delivery';

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
              COALESCE(delivery_est_mins, 30)     AS delivery_est_mins,
              COALESCE(commission_rate, 2)        AS commission_rate
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
    let deliveryLat = null;
    let deliveryLng = null;
    if (order_type === 'delivery') {
      if (!cafe.delivery_enabled) {
        await client.query('ROLLBACK');
        return fail(res, 'This café does not offer delivery', 400);
      }
      const delivery = await resolveDelivery(cafe, req.body);
      if (delivery.error) {
        await client.query('ROLLBACK');
        return fail(res, delivery.error, 400);
      }
      deliveryFee = delivery.fee;
      deliveryLat = delivery.lat;
      deliveryLng = delivery.lng;
    }

    // Validate all items belong to this café and are available — multi-tenant scoped
    const itemIds = items.map((i) => i.menu_item_id);
    const uniqueItemIds = [...new Set(itemIds)];
    const menuResult = await client.query(
      `SELECT id, category_id, name, price, track_stock, stock_quantity FROM menu_items
       WHERE id = ANY($1) AND cafe_id = $2 AND is_available = true
       FOR UPDATE`,
      [uniqueItemIds, cafeId]
    );

    if (menuResult.rows.length !== uniqueItemIds.length) {
      await client.query('ROLLBACK');
      return fail(res, 'One or more items are unavailable or invalid');
    }

    const menuMap = {};
    menuResult.rows.forEach((item) => { menuMap[item.id] = item; });
    const quantitiesByItem = items.reduce((acc, item) => {
      acc[item.menu_item_id] = (acc[item.menu_item_id] || 0) + item.quantity;
      return acc;
    }, {});

    // Stock check — reject if any tracked item has insufficient quantity
    for (const [menuItemId, quantity] of Object.entries(quantitiesByItem)) {
      const mi = menuMap[menuItemId];
      if (mi.track_stock && mi.stock_quantity !== null && mi.stock_quantity < quantity) {
        await client.query('ROLLBACK');
        return fail(res, `"${mi.name}" only has ${mi.stock_quantity} left in stock`);
      }
    }

    // Calculate total server-side (never trust client price)
    let total = 0;
    const variantIds = items
      .filter((i) => i.variant_id)
      .map((i) => i.variant_id);

    const [variantResult, availableVariantsResult, modifierGroupsResult] = await Promise.all([
      variantIds.length > 0
        ? client.query(
            `SELECT id, item_id, name, price FROM item_variants
             WHERE id = ANY($1) AND is_available = true`,
            [variantIds]
          )
        : Promise.resolve({ rows: [] }),
      client.query(
        `SELECT id, item_id FROM item_variants
         WHERE item_id = ANY($1) AND is_available = true`,
        [uniqueItemIds]
      ),
      client.query(
        `WITH effective_groups AS (
           SELECT mi.id AS item_id, cmg.group_id, cmg.sort_order, 0 AS source_rank
           FROM menu_items mi
           JOIN category_modifier_groups cmg ON cmg.category_id = mi.category_id
           WHERE mi.id = ANY($1) AND mi.cafe_id = $2
           UNION ALL
           SELECT img.item_id, img.group_id, img.sort_order, 1 AS source_rank
           FROM item_modifier_groups img
           WHERE img.item_id = ANY($1)
         ),
         deduped AS (
           SELECT DISTINCT ON (item_id, group_id) item_id, group_id, sort_order, source_rank
           FROM effective_groups
           ORDER BY item_id, group_id, source_rank DESC, sort_order
         )
         SELECT d.item_id, g.id AS group_id, g.name AS group_name,
                g.selection_type, g.is_required, g.min_selections, g.max_selections,
                o.id AS option_id, o.name AS option_name, o.price AS option_price
         FROM deduped d
         JOIN modifier_groups g ON g.id = d.group_id AND g.cafe_id = $2
         LEFT JOIN modifier_options o ON o.group_id = g.id AND o.is_available = true
         ORDER BY d.item_id, d.source_rank, d.sort_order, g.sort_order, o.sort_order`,
        [uniqueItemIds, cafeId]
      ),
    ]);

    const variantMap = variantResult.rows.reduce((acc, variant) => {
      acc[variant.id] = variant;
      return acc;
    }, {});
    const variantsByItem = availableVariantsResult.rows.reduce((acc, variant) => {
      acc[variant.item_id] = acc[variant.item_id] || [];
      acc[variant.item_id].push(variant);
      return acc;
    }, {});

    const modifierGroupsByItem = {};
    modifierGroupsResult.rows.forEach((row) => {
      modifierGroupsByItem[row.item_id] = modifierGroupsByItem[row.item_id] || {};
      const group = modifierGroupsByItem[row.item_id][row.group_id] || {
        id: row.group_id,
        name: row.group_name,
        selection_type: row.selection_type,
        is_required: row.is_required,
        min_selections: parseInt(row.min_selections, 10) || 0,
        max_selections: parseInt(row.max_selections, 10) || 1,
        options: {},
      };
      if (row.option_id) {
        group.options[row.option_id] = {
          id: row.option_id,
          name: row.option_name,
          price: parseFloat(row.option_price) || 0,
        };
      }
      modifierGroupsByItem[row.item_id][row.group_id] = group;
    });

    const orderItems = [];
    for (const i of items) {
      const menuItem = menuMap[i.menu_item_id];
      if (!menuItem) {
        await client.query('ROLLBACK');
        return fail(res, 'Invalid item in order', 400);
      }

      let unitPrice = parseFloat(menuItem.price) || 0;
      let variantName = null;
      if (i.variant_id) {
        const variant = variantMap[i.variant_id];
        if (!variant || variant.item_id !== i.menu_item_id) {
          await client.query('ROLLBACK');
          return fail(res, 'Invalid variant selection', 400);
        }
        unitPrice = parseFloat(variant.price) || unitPrice;
        variantName = variant.name;
      } else if ((variantsByItem[i.menu_item_id] || []).length > 0) {
        await client.query('ROLLBACK');
        return fail(res, `Please select a variant for "${menuItem.name}"`, 400);
      }

      const groups = Object.values(modifierGroupsByItem[i.menu_item_id] || {});
      const submittedModifiers = Array.isArray(i.selected_modifiers) ? i.selected_modifiers : [];
      const selectedByGroup = {};
      for (const mod of submittedModifiers) {
        const groupId = mod?.group_id;
        const optionId = mod?.option_id;
        const group = groups.find((g) => g.id === groupId);
        const option = group?.options?.[optionId];
        if (!group || !option) {
          await client.query('ROLLBACK');
          return fail(res, `Invalid or unavailable add-on selected for "${menuItem.name}"`, 400);
        }
        selectedByGroup[groupId] = selectedByGroup[groupId] || [];
        if (!selectedByGroup[groupId].some((selected) => selected.option_id === optionId)) {
          selectedByGroup[groupId].push({
            group_id: group.id,
            group_name: group.name,
            option_id: option.id,
            option_name: option.name,
            price: option.price,
          });
        }
      }

      for (const group of groups) {
        const selections = selectedByGroup[group.id] || [];
        const minSelections = group.is_required || selections.length > 0 ? group.min_selections : 0;
        const maxSelections = group.selection_type === 'single' ? 1 : group.max_selections;
        if (group.is_required && selections.length === 0) {
          await client.query('ROLLBACK');
          return fail(res, `Please select ${group.name} for "${menuItem.name}"`, 400);
        }
        if (selections.length < minSelections) {
          await client.query('ROLLBACK');
          return fail(res, `Please select at least ${minSelections} option(s) for ${group.name}`, 400);
        }
        if (selections.length > maxSelections) {
          await client.query('ROLLBACK');
          return fail(res, `Please select no more than ${maxSelections} option(s) for ${group.name}`, 400);
        }
      }

      const selectedModifiers = groups.flatMap((group) => selectedByGroup[group.id] || []);
      const modifierTotal = selectedModifiers.reduce((sum, mod) => sum + mod.price, 0);
      const subtotal = parseFloat((unitPrice + modifierTotal) * i.quantity).toFixed(2);
      total += parseFloat(subtotal);

      orderItems.push({
        menu_item_id: i.menu_item_id,
        quantity: i.quantity,
        unit_price: unitPrice + modifierTotal,
        item_name: menuItem.name, // never the client-sent name — kitchen + bill show this
        variant_id: i.variant_id || null,
        variant_name: variantName,
        selected_modifiers: selectedModifiers,
        modifier_total: modifierTotal,
      });
    }

    // Delivery minimum is on the item subtotal (before discounts, tax, fees)
    if (order_type === 'delivery' && total < parseFloat(cafe.delivery_min_order || 0)) {
      await client.query('ROLLBACK');
      return fail(res, `Minimum order for delivery is ₹${parseFloat(cafe.delivery_min_order)}`, 400);
    }

    // Apply best active offer or coupon code
    let offerId         = null;
    let platformOfferId = null;
    let offerFundedBy   = null;
    let discountAmount  = 0;
    let finalAmount     = total;

    if (req.body.coupon_code) {
      const result = await applyCoupon(cafeId, req.body.coupon_code, items, total, customer_phone || null);
      offerId         = result.offerId;
      platformOfferId = result.platformOfferId;
      offerFundedBy   = result.fundedBy;
      discountAmount  = result.discountAmount;
      finalAmount     = result.finalAmount;
    } else {
      const result = await applyBestOffer(cafeId, items, total, customer_phone || null);
      offerId         = result.offerId;
      platformOfferId = result.platformOfferId;
      offerFundedBy   = result.fundedBy;
      discountAmount  = result.discountAmount;
      finalAmount     = result.finalAmount;
    }

    if (offerId && typeof offerId === 'string' && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(offerId)) {
      logger.error('Invalid offerId format, ignoring offer:', offerId);
      offerId = null;
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

    // Platform fee — transparent charge shown on customer bill
    const commissionRate = parseFloat(cafe.commission_rate ?? 2);
    const platformFee = commissionRate > 0
      ? parseFloat((trueFinal * commissionRate / 100).toFixed(2))
      : 0;
    trueFinal = parseFloat((trueFinal + platformFee).toFixed(2));

    // ── Trust check: the price the customer was shown must equal what we charge.
    // Frontend may pass `client_quoted_total` — the rupee amount on the "Place Order"
    // button. If it disagrees with our computed final by more than ₹1 (rounding),
    // refuse the order with a clear error so the customer can refresh and re-confirm
    // at the correct price. Prevents the "shown ₹306, charged ₹315" trust violation.
    if (req.body.client_quoted_total != null) {
      const quoted = parseFloat(req.body.client_quoted_total);
      if (!Number.isNaN(quoted) && Math.abs(quoted - trueFinal) > 1.0) {
        await client.query('ROLLBACK');
        logger.warn(
          'Order price drift for cafe %s: quoted ₹%s, computed ₹%s (Δ ₹%s)',
          cafeId, quoted.toFixed(2), trueFinal.toFixed(2), (trueFinal - quoted).toFixed(2)
        );
        return fail(
          res,
          `Price changed since you opened the cart (was ₹${quoted.toFixed(2)}, now ₹${trueFinal.toFixed(2)}). Please refresh to see the latest total.`,
          409
        );
      }
    }

    // Verified table: only from the table's secret QR token. Otherwise the
    // typed table is kept for staff but the order is held off table bills.
    let tableId = null;
    let tableVerified = !isDineIn;
    let partyId = null;
    let partySecret = null;
    if (isDineIn) {
      const qrTable = await tableFromQrToken(client, cafeId, req.body.table_token);
      if (qrTable) {
        tableId = qrTable.id;
        tableNum = qrTable.label;
        tableVerified = true;
      }
      // Party = this device's orders, identified by a server-issued secret
      if (typeof req.body.party_secret === 'string' && req.body.party_secret) {
        const p = await client.query('SELECT id, secret FROM dining_parties WHERE secret = $1 AND cafe_id = $2', [req.body.party_secret, cafeId]);
        if (p.rows.length) ({ id: partyId, secret: partySecret } = p.rows[0]);
      }
      if (!partyId) {
        const p = await client.query(
          'INSERT INTO dining_parties (cafe_id, secret) VALUES ($1, $2) RETURNING id, secret',
          [cafeId, generateOrderToken()]
        );
        ({ id: partyId, secret: partySecret } = p.rows[0]);
      }
    }

    // Insert order
    const customerToken = generateOrderToken();
    let orderResult;
    try {
      orderResult = await client.query(
        `INSERT INTO orders
           (cafe_id, customer_name, customer_phone, table_number, order_type,
            total_amount, discount_amount, tip_amount, final_amount,
            tax_amount, tax_rate,
            offer_id, platform_offer_id, platform_discount_amount,
            notes, client_order_id,
            delivery_address, delivery_address2, delivery_city, delivery_zipcode,
            delivery_phone, delivery_lat, delivery_lng, delivery_instructions,
            delivery_fee, delivery_status, reservation_id,
            platform_fee, platform_fee_rate, customer_token,
            table_id, table_verified, party_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
                 $31,$32,$33)
         RETURNING id, order_number, customer_name, customer_phone, table_number, order_type,
                   status, total_amount, discount_amount, tip_amount, final_amount,
                   tax_amount, tax_rate, notes, created_at,
                   delivery_address, delivery_phone, delivery_fee, delivery_status,
                   reservation_id, platform_fee, platform_fee_rate,
                   platform_offer_id, platform_discount_amount`,
        [cafeId, customer_name, customer_phone || null, tableNum, order_type,
         trueTotal, discountAmount, tip, trueFinal,
         taxAmount, rate,
         offerId || null,
         platformOfferId || null,
         offerFundedBy === 'platform' ? discountAmount : 0,
         notes || null, client_order_id || null,
         order_type === 'delivery' ? (delivery_address || null) : null,
         order_type === 'delivery' ? (delivery_address2 || null) : null,
         order_type === 'delivery' ? (delivery_city || null) : null,
         order_type === 'delivery' ? (delivery_zipcode || null) : null,
         order_type === 'delivery' ? (delivery_phone || null) : null,
         order_type === 'delivery' ? deliveryLat : null,
         order_type === 'delivery' ? deliveryLng : null,
         order_type === 'delivery' ? (delivery_instructions || null) : null,
         deliveryFee || 0,
         order_type === 'delivery' ? 'pending' : null,
         reservation_id ? parseInt(reservation_id) : null,
         platformFee, commissionRate, customerToken,
         tableId, tableVerified, partyId]
      );
    } catch (insertErr) {
      await client.query('ROLLBACK');
      if (insertErr.code === '23505' && insertErr.constraint === 'orders_client_order_id_idx') {
        // Idempotent: return the existing order so the client can resume normally
        const existingResult = await db.query(
          `SELECT o.id, o.customer_token, p.secret AS party_secret
           FROM orders o LEFT JOIN dining_parties p ON p.id = o.party_id
           WHERE o.client_order_id = $1 AND o.cafe_id = $2`,
          [client_order_id, cafeId]
        );
        if (existingResult.rows.length > 0) {
          const { id: existingId, customer_token: existingToken, party_secret: existingParty } = existingResult.rows[0];
          const existing = await getOrderWithItems(existingId);
          return ok(res, { order: { ...existing, customer_token: existingToken }, party_secret: existingParty }, 'Order already placed', 200);
        }
        return fail(res, 'This order has already been placed', 409);
      }
      throw insertErr;
    }
    const order = orderResult.rows[0];

    // Bulk insert order items
    const valuePlaceholders = orderItems
      .map((_, i) => `($1, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8}, $${i * 8 + 9})`)
      .join(', ');
    const itemValues = orderItems.flatMap((oi) => [
      oi.menu_item_id,
      oi.quantity,
      oi.unit_price,
      oi.item_name,
      oi.variant_id,
      oi.variant_name,
      JSON.stringify(oi.selected_modifiers),
      oi.modifier_total,
    ]);
    await client.query(
      `INSERT INTO order_items
         (order_id, menu_item_id, quantity, unit_price, item_name,
          variant_id, variant_name, selected_modifiers, modifier_total)
       VALUES ${valuePlaceholders}`,
      [order.id, ...itemValues]
    );

    // Decrement stock and auto-disable sold-out items
    for (const [menuItemId, quantity] of Object.entries(quantitiesByItem)) {
      const mi = menuMap[menuItemId];
      if (mi.track_stock && mi.stock_quantity !== null) {
        const newQty = mi.stock_quantity - quantity;
        await client.query(
          `UPDATE menu_items
           SET stock_quantity = $1,
               is_available   = CASE WHEN $1 <= 0 THEN false ELSE is_available END
           WHERE id = $2`,
          [newQty, menuItemId]
        );
        if (newQty <= 0) {
          req.io?.to(`cafe:${cafeId}`).emit('item_sold_out', { menu_item_id: menuItemId, name: mi.name });
          // Persist + email alert for sold-out (fire-and-forget, outside transaction)
          notify(req.io, cafeId, cafeEmail, {
            type:  'item_sold_out',
            title: `"${mi.name}" is sold out`,
            body:  'Stock hit zero — the item has been hidden from the menu.',
            refId: menuItemId,
            email: true,
          }).catch(() => {});
        }
      }
    }

    // Mark reservation as seated and link it to this order
    if (reservation_id) {
      await client.query(
        `UPDATE reservations
         SET status = 'seated', order_id = $1
         WHERE id = $2 AND cafe_id = $3 AND status IN ('pending', 'confirmed')`,
        [order.id, parseInt(reservation_id), cafeId]
      );
    }

    // Atomic uses_count increment with cap enforcement (still inside transaction).
    // The conditional UPDATE only succeeds if uses_count < max_uses (or max_uses is NULL).
    // If it fails, the offer is over its cap — strip the discount from this order
    // rather than blocking the order outright. Customer keeps their order, no over-redemption.
    if (offerId) {
      const upd = await client.query(
        `UPDATE offers SET uses_count = uses_count + 1
         WHERE id = $1 AND (max_uses IS NULL OR uses_count < max_uses)
         RETURNING id`,
        [offerId]
      );
      if (upd.rows.length === 0) {
        // Cap reached between preview and commit — revert the discount on this order
        await client.query(
          `UPDATE orders SET offer_id = NULL, discount_amount = 0,
                             final_amount = final_amount + $1
           WHERE id = $2`,
          [discountAmount, order.id]
        );
        offerId = null;
        discountAmount = 0;
      } else {
        // Log redemption for per-customer tracking
        await client.query(
          `INSERT INTO offer_redemptions (offer_id, order_id, cafe_id, customer_phone, discount_amount)
           VALUES ($1, $2, $3, $4, $5)`,
          [offerId, order.id, cafeId, customer_phone || null, discountAmount]
        );
      }
    } else if (platformOfferId) {
      const upd = await client.query(
        `UPDATE platform_offers SET uses_count = uses_count + 1
         WHERE id = $1 AND (max_uses IS NULL OR uses_count < max_uses)
         RETURNING id`,
        [platformOfferId]
      );
      if (upd.rows.length === 0) {
        await client.query(
          `UPDATE orders SET platform_offer_id = NULL, platform_discount_amount = 0,
                             discount_amount = 0,
                             final_amount = final_amount + $1
           WHERE id = $2`,
          [discountAmount, order.id]
        );
        platformOfferId = null;
        discountAmount  = 0;
      } else {
        // Log redemption for per-customer tracking
        await client.query(
          `INSERT INTO offer_redemptions (platform_offer_id, order_id, cafe_id, customer_phone, discount_amount)
           VALUES ($1, $2, $3, $4, $5)`,
          [platformOfferId, order.id, cafeId, customer_phone || null, discountAmount]
        );
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

    // Web Push to owner devices (fire-and-forget, outside transaction)
    sendToOwners(cafeId, {
      title: `🔔 New Order — ${orderLabel}`,
      body:  `${customer_name} · ${itemCount} item${itemCount !== 1 ? 's' : ''} · ₹${fullOrder.final_amount}`,
      url:   '/owner/orders',
    }).catch(() => {});

    logger.info('Order #%s placed at café %s table %s', order.order_number, slug, table_number);
    // customer_token goes only to the customer — never in socket/owner payloads
    ok(res, { order: { ...fullOrder, customer_token: customerToken }, party_secret: partySecret }, 'Order placed', 201);
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
              o.order_type, o.status, o.kitchen_mode, o.accepted,
              o.total_amount, o.tax_amount, o.tax_rate, o.discount_amount,
              o.tip_amount, o.delivery_fee, o.final_amount,
              o.payment_verified, o.cancellation_reason, o.payment_mode, o.cash_received, o.payment_splits,
              o.notes, o.created_at, o.updated_at,
              o.table_id, o.table_verified, o.party_id, o.moved_from_table, o.moved_at
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
        'SELECT id, order_id, menu_item_id, item_name, quantity, unit_price, subtotal, variant_id, variant_name, selected_modifiers, modifier_total, item_status FROM order_items WHERE order_id = ANY($1)',
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

// ─── Owner/Staff: kitchen display feed ────────────────────────
// Every active order (no page limit — on a busy day the generic list's limit
// pushed live orders off the screen), with the item fields the KDS needs.
const KITCHEN_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];
exports.getKitchenOrders = asyncHandler(async (req, res) => {
  const ordersResult = await db.query(
    `SELECT o.id, o.order_number,
            COALESCE(o.daily_order_number, o.order_number) AS daily_order_number,
            o.customer_name, o.table_number,
            o.order_type, o.status, o.kitchen_mode, o.accepted,
            o.total_amount, o.final_amount, o.payment_verified,
            o.notes, o.created_at, o.updated_at,
            o.table_id, o.table_verified, o.party_id, o.moved_from_table, o.moved_at
     FROM orders o
     WHERE o.cafe_id = $1 AND o.status = ANY($2)
     ORDER BY o.created_at ASC
     LIMIT 1000`,
    [req.cafeId, KITCHEN_STATUSES]
  );
  const orderIds = ordersResult.rows.map((o) => o.id);
  const itemsResult = orderIds.length > 0
    ? await db.query(
        `SELECT oi.id, oi.order_id, oi.menu_item_id, oi.item_name, oi.quantity, oi.unit_price, oi.subtotal,
                oi.variant_id, oi.variant_name, oi.selected_modifiers, oi.modifier_total,
                oi.item_status, oi.accepted, oi.cancellation_reason,
                COALESCE(oi.sort_order, 0) AS sort_order,
                oi.preparing_at, oi.ready_at, oi.served_at, oi.cancelled_at,
                oi.prep_started_at, oi.prep_duration_mins,
                mi.is_veg, mi.default_prep_mins,
                COALESCE(NULLIF(cat.station, ''), NULLIF(pcat.station, '')) AS station
         FROM order_items oi
         LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
         LEFT JOIN categories cat ON cat.id = mi.category_id
         LEFT JOIN categories pcat ON pcat.id = cat.parent_id
         WHERE oi.order_id = ANY($1)
         ORDER BY oi.sort_order ASC, oi.id ASC`,
        [orderIds]
      )
    : { rows: [] };
  const itemsByOrderId = {};
  for (const item of itemsResult.rows) {
    (itemsByOrderId[item.order_id] ||= []).push(item);
  }
  // Stations this café uses, for the KDS station picker
  const stationsResult = await db.query(
    `SELECT DISTINCT station FROM categories
     WHERE cafe_id = $1 AND station IS NOT NULL AND station <> '' ORDER BY station`,
    [req.cafeId]
  );
  ok(res, {
    orders: ordersResult.rows.map((o) => ({ ...o, items: itemsByOrderId[o.id] || [] })),
    stations: stationsResult.rows.map((r) => r.station),
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
  const { status, cash_received, cancellation_reason, payment_mode, payment_splits } = req.body;

  const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'paid', 'cancelled'];
  if (!validStatuses.includes(status)) return fail(res, 'Invalid status');
  // Taking payment is a cash-handling action — not for kitchen/waiter staff
  if (status === 'paid' && req.role === 'STAFF' && !['manager', 'cashier'].includes(req.staffRole)) {
    return fail(res, 'Not allowed for your role', 403);
  }

  // Acquire a per-order advisory lock so concurrent requests for the same order
  // serialize here instead of both passing the transition check simultaneously.
  // hashtext() maps the UUID string to a 32-bit int for pg_try_advisory_xact_lock.
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const lockRes = await client.query(
      `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired`, [id]
    );
    if (!lockRes.rows[0].acquired) {
      await client.query('ROLLBACK');
      return fail(res, 'Order is already being updated — please try again', 409);
    }

  // Fetch current status + payment flag + transfer flag to set commission_status correctly
  const currentRow = await client.query(
    `SELECT status, payment_verified, razorpay_transfer_id,
            COALESCE(payment_mode, '') AS payment_mode
     FROM orders WHERE id = $1 AND cafe_id = $2`,
    [id, req.cafeId]
  );
  if (currentRow.rows.length === 0) {
    await client.query('ROLLBACK');
    return fail(res, 'Order not found', 404);
  }
  const { status: currentStatus, payment_verified: isPrepaid,
          razorpay_transfer_id: existingTransferId,
          payment_mode: existingPaymentMode } = currentRow.rows[0];

  // Prepaid orders (Razorpay already charged) may be completed from any active state —
  // staff don't need to open the billing modal; they just mark it done.
  const TRANSITIONS = {
    pending:   ['confirmed', 'cancelled', ...(isPrepaid ? ['paid'] : [])],
    confirmed: ['preparing', 'cancelled', ...(isPrepaid ? ['paid'] : [])],
    // One step back = the KDS "Recall" (undo an accidental bump)
    preparing: ['ready',    'cancelled', 'confirmed', ...(isPrepaid ? ['paid'] : [])],
    ready:     ['served',   'preparing',              ...(isPrepaid ? ['paid'] : [])],
    served:    ['paid',     'ready'],
    paid:      [],
    cancelled: [],
  };
  if (!TRANSITIONS[currentStatus]?.includes(status)) {
    await client.query('ROLLBACK');
    return fail(res, `Cannot move order from "${currentStatus}" to "${status}"`, 400);
  }

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
  const validModes = ['cash', 'upi', 'card', 'online', 'split'];
  if (status === 'paid' && payment_mode && validModes.includes(payment_mode)) {
    setClauses.push(`payment_mode = $${idx++}`);
    params.push(payment_mode);
  }
  // Split bill: each share's amount + how it was paid (counter modes only)
  if (status === 'paid' && payment_mode === 'split' && payment_splits !== undefined) {
    const splits = Array.isArray(payment_splits) ? payment_splits : null;
    const valid = splits && splits.length >= 2 && splits.length <= 20 && splits.every((p) =>
      ['cash', 'upi', 'card'].includes(p?.mode) && Number.isFinite(Number(p?.amount)) && Number(p.amount) > 0);
    if (!valid) {
      await client.query('ROLLBACK');
      return fail(res, 'payment_splits must be 2–20 shares, each { amount > 0, mode: cash|upi|card }', 400);
    }
    setClauses.push(`payment_splits = $${idx++}::jsonb`);
    params.push(JSON.stringify(splits.map((p) => ({ amount: Math.round(Number(p.amount) * 100) / 100, mode: p.mode }))));
  }

  params.push(id, req.cafeId);
  const idIdx   = idx++;
  const cafeIdx = idx;

  const result = await client.query(
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
  if (result.rows.length === 0) {
    await client.query('ROLLBACK');
    return fail(res, 'Order not found', 404);
  }
  const fromStatus = result.rows[0].prev_status;

  // Move items forward with the order (never backwards, never cancelled ones),
  // so a Ready order doesn't still show its items as Pending on the KDS.
  const ITEM_STATUS_FOR = { preparing: 'preparing', ready: 'ready', served: 'served', paid: 'served' };
  const itemStatus = ITEM_STATUS_FOR[status];
  const ORDER_RANK = { pending: 0, confirmed: 1, preparing: 2, ready: 3, served: 4, paid: 5 };
  if (ORDER_RANK[status] < ORDER_RANK[currentStatus]) {
    // Recall: pull items that ran ahead back to the order's new stage
    const back = { confirmed: 'pending', preparing: 'preparing', ready: 'ready' }[status];
    await client.query(
      `UPDATE order_items SET item_status = $1,
         ready_at  = CASE WHEN $1 IN ('pending', 'preparing') THEN NULL ELSE ready_at END,
         served_at = NULL
       WHERE order_id = $2
         AND item_status <> 'cancelled'
         AND array_position(ARRAY['pending','preparing','ready','served']::text[], item_status::text)
           > array_position(ARRAY['pending','preparing','ready','served']::text[], $1::text)`,
      [back, id]
    );
  } else if (itemStatus) {
    await client.query(
      `UPDATE order_items SET
         item_status  = $1,
         preparing_at = COALESCE(preparing_at, NOW()),
         ready_at     = CASE WHEN $1 IN ('ready', 'served') THEN COALESCE(ready_at, NOW()) ELSE ready_at END,
         served_at    = CASE WHEN $1 = 'served' THEN COALESCE(served_at, NOW()) ELSE served_at END
       WHERE order_id = $2
         AND item_status <> 'cancelled'
         AND array_position(ARRAY['pending','preparing','ready','served']::text[], item_status::text)
           < array_position(ARRAY['pending','preparing','ready','served']::text[], $1::text)`,
      [itemStatus, id]
    );
  }

  await client.query('COMMIT');

  // Log the status transition (fire-and-forget)
  db.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, actor_name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, fromStatus, status,
     req.role === 'STAFF' ? 'staff' : 'owner',
     req.staffId || req.cafeId,
     null]
  ).catch((err) => logger.warn('order_events insert failed for order %s: %s', id, err.message));

  const updatedOrder = result.rows[0];
  if (req.io) {
    req.io.to(`cafe:${req.cafeId}`).emit('order_updated', updatedOrder);
    req.io.to(`order:${id}`).emit('order_updated', updatedOrder);
  }

  if (status === 'cancelled' && isPrepaid) {
    refundPrepaidOrder(id, cancellation_reason || 'Cancelled by café');
  }

  if (status === 'paid' && fromStatus !== 'paid') {
    db.query(
      `SELECT customer_phone, final_amount, platform_fee, payment_verified, payment_mode
       FROM orders WHERE id = $1`, [id]
    ).then(async (fullOrder) => {
      if (!fullOrder.rows.length) return;
      const { customer_phone, final_amount, platform_fee, payment_verified,
              payment_mode: dbPaymentMode } = fullOrder.rows[0];

      const commissionAmount = parseFloat(platform_fee || 0);
      const resolvedMode     = payment_mode || dbPaymentMode || 'cash';
      // Prepaid through DineVerse's Razorpay: the platform already holds the
      // commission (Route pays the café only the net). Only money the café
      // collected itself (cash/UPI/card at the counter) leaves commission due.
      // Keying this off razorpay_transfer_id billed prepaid orders twice.
      const commissionStatus = payment_verified ? 'auto_deducted' : 'cash_due';

      await db.query(
        `UPDATE orders
         SET commission_amount  = $1,
             commission_status  = $2,
             payment_mode       = COALESCE(payment_mode, $3)
         WHERE id = $4`,
        [commissionAmount, commissionStatus, resolvedMode, id]
      ).catch((e) => logger.warn('commission write failed: %s', e.message));

      logger.info(
        'Order %s paid: ₹%s commission — status=%s mode=%s',
        id, commissionAmount, commissionStatus, resolvedMode
      );

      require('./loyaltyController').earnPoints(req.cafeId, id, customer_phone, final_amount);
    }).catch((e) => logger.warn('post-paid hooks failed for order %s: %s', id, e.message));
  }

  ok(res, { order: updatedOrder });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// ─── Owner: dashboard stats ───────────────────────────────────
exports.getDashboardStats = asyncHandler(async (req, res) => {
  const [todayStats, statusCounts, topItems, recentOrders] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'cancelled') AS total_orders,
         COALESCE(SUM(final_amount - COALESCE(platform_fee,0) + COALESCE(platform_discount_amount,0)) FILTER (WHERE status = 'paid'), 0) AS total_revenue
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
            o.customer_token, o.refund_status, o.table_verified, o.payment_verified,
            c.latitude AS cafe_lat, c.longitude AS cafe_lng, c.name AS cafe_name
     FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND c.slug = $2`,
    [id, slug]
  );
  if (result.rows.length === 0) return fail(res, 'Order not found', 404);
  const { customer_token, ...order } = result.rows[0];
  if (!canAccessOrder(req, customer_token)) return fail(res, 'Order not found', 404);
  ok(res, { order });
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
      `SELECT o.id, o.status, o.cafe_id, o.customer_name, o.customer_phone, o.customer_token
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
    if (order.customer_token && !hasOrderToken(req, order.customer_token)) {
      await client.query('ROLLBACK');
      return fail(res, 'Order not found', 404);
    }
    // Legacy orders (no token): only verify identity when the order has stored customer info.
    // If the DB has a name, the sent name must match; same for phone.
    // If neither is stored (anonymous order), allow cancel without check.
    const hasStoredName  = !!order.customer_name?.trim();
    const hasStoredPhone = !!order.customer_phone?.trim();
    if (!order.customer_token && (hasStoredName || hasStoredPhone)) {
      const nameMatch  = hasStoredName  && customer_name  && order.customer_name.trim().toLowerCase() === customer_name.trim().toLowerCase();
      const phoneMatch = hasStoredPhone && customer_phone && order.customer_phone.trim() === customer_phone.trim();
      if (!nameMatch && !phoneMatch) {
        await client.query('ROLLBACK');
        return fail(res, 'Order not found', 404);
      }
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

    // Restore stock for tracked items in this order
    await client.query(
      `UPDATE menu_items mi
       SET stock_quantity = mi.stock_quantity + oi.quantity,
           is_available   = true
       FROM order_items oi
       WHERE oi.order_id = $1
         AND oi.menu_item_id = mi.id
         AND mi.track_stock = true
         AND mi.stock_quantity IS NOT NULL`,
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

    refundPrepaidOrder(id, 'Cancelled by customer');
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
            notes, created_at, customer_name, customer_token
     FROM orders
     WHERE cafe_id = $1
       AND table_number = $2
       AND table_verified = true  -- unconfirmed orders never reach a table bill
       AND status NOT IN ('cancelled', 'paid')
     ORDER BY created_at ASC`,
    [cafeId, tableNumber]
  );

  if (ordersResult.rows.length === 0) {
    return ok(res, { orders: [], combined_total: 0, cafe_name: cafeName });
  }

  // Caller must hold the token of at least one order at this table —
  // otherwise anyone could enumerate tables and harvest order IDs.
  const tokens = sentOrderTokens(req);
  const anyOrderHasToken = ordersResult.rows.some((o) => o.customer_token);
  if (anyOrderHasToken) {
    const holdsOne = ordersResult.rows.some(
      (o) => o.customer_token && tokens.some((t) => safeEqual(t, o.customer_token))
    );
    if (!holdsOne) return fail(res, 'Table bill not found', 404);
  }

  // Legacy (all orders pre-token): require a matching customer_name
  const { customer_name } = req.query;
  const anyOrderHasName = ordersResult.rows.some((o) => !!o.customer_name?.trim());
  if (!anyOrderHasToken && anyOrderHasName) {
    if (!customer_name?.trim()) return fail(res, 'customer_name is required to view this bill', 400);
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

  const orders = ordersResult.rows.map(({ customer_token, customer_name: _name, ...o }) => ({ ...o, items: itemsByOrder[o.id] || [] }));
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
              o.platform_fee, o.platform_fee_rate,
              o.payment_verified, o.cancellation_reason, o.payment_mode, o.cash_received, o.payment_splits,
              o.notes, o.created_at, o.updated_at,
              o.delivery_address, o.delivery_address2, o.delivery_city, o.delivery_zipcode,
              o.delivery_phone, o.delivery_instructions, o.delivery_status,
              o.driver_name, o.driver_phone, o.delivered_at, o.delivery_failed_reason,
              o.kitchen_mode, o.accepted,
              o.table_id, o.table_verified, o.party_id, o.moved_from_table, o.moved_at
       FROM orders o WHERE o.id = $1${cafeFilter}`,
      params
    ),
    db.query(
      `SELECT oi.id, oi.menu_item_id, oi.item_name, oi.quantity, oi.unit_price, oi.subtotal,
              oi.variant_id, oi.variant_name, oi.selected_modifiers, oi.modifier_total,
              oi.item_status, oi.accepted, oi.cancellation_reason,
              COALESCE(oi.sort_order, 0) AS sort_order,
              oi.preparing_at, oi.ready_at, oi.served_at, oi.cancelled_at,
              oi.prep_started_at, oi.prep_duration_mins,
              mi.is_veg, mi.default_prep_mins,
              COALESCE(NULLIF(cat.station, ''), NULLIF(pcat.station, '')) AS station
       FROM order_items oi
       LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
       LEFT JOIN categories cat ON cat.id = mi.category_id
       LEFT JOIN categories pcat ON pcat.id = cat.parent_id
       WHERE oi.order_id = $1
       ORDER BY oi.sort_order ASC, oi.id ASC`,
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
            o.payment_order_id, o.platform_fee, o.platform_discount_amount,
            o.customer_name, o.order_number, o.customer_token,
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
  if (!canAccessOrder(req, order.customer_token)) return fail(res, 'Order not found', 404);

  if (order.payment_verified) return fail(res, 'Order already paid', 409);
  if (['cancelled', 'paid'].includes(order.status)) {
    return fail(res, 'Cannot process payment for this order', 400);
  }

  const amountPaise = Math.round(parseFloat(order.final_amount || order.total_amount) * 100);
  if (amountPaise <= 0) return fail(res, 'Invalid order amount', 400);

  // Idempotency: if a Razorpay order already exists for this order (e.g. customer retrying
  // after a network drop during verify), reuse it rather than creating a duplicate.
  // Razorpay orders are single-use — a captured order can't be paid again anyway, so
  // returning the existing order_id is safe and prevents double-charge scenarios.
  if (order.payment_order_id) {
    try {
      const existingRpOrder = await razorpay.orders.fetch(order.payment_order_id);
      if (existingRpOrder.status === 'created') {
        // Still open — give the same order back so the customer completes it
        return ok(res, {
          razorpay_order_id:   existingRpOrder.id,
          amount:              amountPaise,
          currency:            order.cafe_currency || 'INR',
          cafe_name:           order.cafe_name,
          cafe_logo_url:       order.cafe_logo_url || null,
          customer_name:       order.customer_name,
          daily_order_number:  order.daily_order_number,
          route_enabled:       false,
          key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
        });
      }
      // Paid/expired on Razorpay but not verified here — let a new order be created below
    } catch (fetchErr) {
      logger.warn('Could not fetch existing Razorpay order %s for reuse: %s', order.payment_order_id, fetchErr.message);
      // Fall through and create a fresh order
    }
  }

  // Build Razorpay Route transfer using the actual stored commission, not a
  // hardcoded percentage. Café gets (final_amount − platform_fee + platform_discount_amount):
  //   • final_amount = customer's bill (incl. platform fee already added on top)
  //   • platform_fee = DineVerse's commission for this order (configurable per café)
  //   • platform_discount_amount = DineVerse-funded discount (refund to café for absorbed promo)
  const routeTransfers = [];
  if (order.razorpay_route_enabled && order.razorpay_account_id) {
    const platformFee     = parseFloat(order.platform_fee || 0);
    const platformCredit  = parseFloat(order.platform_discount_amount || 0);
    const cafeShareRupees = Math.max(0, parseFloat(order.final_amount || 0) - platformFee + platformCredit);
    const cafeSharePaise  = Math.floor(cafeShareRupees * 100);
    // Minimum Razorpay transfer is ₹1 (100 paise); skip routing for tiny orders
    if (cafeSharePaise >= 100) {
      routeTransfers.push({
        account:  order.razorpay_account_id,
        amount:   cafeSharePaise,
        currency: 'INR',
        on_hold:  0,
        notes: {
          cafe_slug:  slug,
          order_id:   id,
          type:       'food_order_payout',
          platform_fee_inr:    platformFee.toFixed(2),
          platform_credit_inr: platformCredit.toFixed(2),
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
// Settle a captured Razorpay payment against its food order. Shared by the
// customer's verify call and the Razorpay webhook (the safety net when the
// customer's phone drops off after paying), so both apply the same checks.
// Locate the order by { id, slug } (verify) or { razorpayOrderId } (webhook).
// Returns { code, httpStatus, message, order? }.
const SETTLE = {
  not_found:         [404, 'Order not found'],
  already_paid:      [409, 'Already paid'],
  order_mismatch:    [400, 'Order ID mismatch'],
  cancelled:         [409, 'This order was cancelled, so your payment is being refunded automatically.'],
  amount_mismatch:   [400, 'Payment amount mismatch — your payment will be refunded automatically.'],
  unavailable:       [503, 'Payment verification temporarily unavailable. Please try again in a moment.'],
  paid:              [200, 'Payment successful!'],
};
const settleResult = (code, order) => ({ code, httpStatus: SETTLE[code][0], message: SETTLE[code][1], order });

async function settleFoodPayment({ id, slug, razorpayOrderId, paymentId, io }) {
  const payClient = await db.pool.connect();
  let updatedOrder;
  let customerPhone;
  let order;
  try {
    await payClient.query('BEGIN');
    // Lock the order row — verify and webhook can race; only one settles
    const result = id
      ? await payClient.query(
          `SELECT o.id, o.status, o.payment_order_id, o.payment_verified, o.cafe_id, o.final_amount
           FROM orders o JOIN cafes c ON o.cafe_id = c.id
           WHERE o.id = $1 AND c.slug = $2 FOR UPDATE OF o`,
          [id, slug])
      : await payClient.query(
          `SELECT id, status, payment_order_id, payment_verified, cafe_id, final_amount
           FROM orders WHERE payment_order_id = $1 FOR UPDATE`,
          [razorpayOrderId]);
    if (result.rows.length === 0) { await payClient.query('ROLLBACK'); return settleResult('not_found'); }
    order = result.rows[0];

    if (order.payment_verified) { await payClient.query('ROLLBACK'); return settleResult('already_paid'); }
    if (razorpayOrderId && order.payment_order_id !== razorpayOrderId) {
      await payClient.query('ROLLBACK');
      return settleResult('order_mismatch');
    }
    // Cancelled while the customer was paying: record the payment but do NOT
    // revive the order — refund it.
    if (order.status === 'cancelled') {
      await payClient.query(
        `UPDATE orders SET payment_id = $1, payment_verified = true, payment_mode = 'online', updated_at = NOW()
         WHERE id = $2`,
        [paymentId, order.id]
      );
      await payClient.query('COMMIT');
      refundPrepaidOrder(order.id, 'Paid after cancellation');
      logger.warn('Payment %s arrived for cancelled order %s — refunding', paymentId, order.id);
      return settleResult('cancelled');
    }

    // The amount actually charged must equal the order total
    try {
      const rzpPayment = await razorpay.payments.fetch(paymentId);
      const expectedPaise = Math.round(parseFloat(order.final_amount) * 100);
      if (rzpPayment.order_id && rzpPayment.order_id !== order.payment_order_id) {
        await payClient.query('ROLLBACK');
        return settleResult('order_mismatch');
      }
      if (parseInt(rzpPayment.amount, 10) !== expectedPaise) {
        logger.warn('Amount mismatch for food order %s: expected %d paise, got %d', order.id, expectedPaise, rzpPayment.amount);
        await payClient.query('ROLLBACK');
        razorpay.payments.refund(paymentId, { amount: rzpPayment.amount }).catch((refundErr) =>
          logger.error('Auto-refund failed for payment %s on order %s: %s', paymentId, order.id, refundErr.message)
        );
        return settleResult('amount_mismatch');
      }
    } catch (fetchErr) {
      logger.warn('Could not fetch payment %s for amount check on food order %s: %s', paymentId, order.id, fetchErr.message);
      await payClient.query('ROLLBACK');
      return settleResult('unavailable');
    }

    // Mark paid. payment_mode='online' in the same transaction so commission
    // tracking treats it as auto-deducted. Only a pending order moves to
    // confirmed — paying must never pull an order the kitchen has already
    // started back to 'confirmed'.
    const updated = await payClient.query(
      `UPDATE orders
       SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
           payment_id = $1, payment_verified = true,
           payment_mode = 'online', updated_at = NOW()
       WHERE id = $2
       RETURNING id, order_number,
                 COALESCE(daily_order_number, order_number) AS daily_order_number,
                 customer_name, customer_phone, table_number, order_type, status,
                 total_amount, final_amount, platform_fee, platform_discount_amount,
                 payment_verified, updated_at`,
      [paymentId, order.id]
    );
    // customer_phone is for loyalty only — never broadcast it to socket rooms
    ({ customer_phone: customerPhone, ...updatedOrder } = updated.rows[0]);
    await payClient.query('COMMIT');
  } catch (err) {
    await payClient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    payClient.release();
  }

  const orderId = order.id;
  const cafeId = order.cafe_id;
  if (order.status === 'pending') {
    db.query(
      `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_name)
       VALUES ($1, 'pending', 'confirmed', 'system', 'Razorpay — prepaid')`,
      [orderId]
    ).catch((err) => logger.warn('order_events insert failed for payment %s: %s', orderId, err.message));
  }

  // Razorpay Route: the café's share is attached as a transfer when the
  // Razorpay order is created (createOrderPayment), so Razorpay pays it out on
  // capture. Do NOT create another transfer here — that would pay the café
  // twice. Just record the transfer id for reconciliation (fire-and-forget).
  razorpay.payments.fetchTransfer(paymentId)
    .then(async (t) => {
      const transferId = t?.items?.[0]?.id;
      if (transferId) {
        await db.query('UPDATE orders SET razorpay_transfer_id = $1 WHERE id = $2', [transferId, orderId]);
        logger.info('Razorpay Route transfer %s recorded for order %s', transferId, orderId);
      }
    })
    .catch((err) => logger.warn('Could not fetch Route transfer for payment %s: %s', paymentId, err.message));

  require('./loyaltyController').earnPoints(cafeId, orderId, customerPhone || null, updatedOrder.final_amount);

  if (io) {
    io.to(`cafe:${cafeId}`).emit('order_updated', updatedOrder);
    io.to(`order:${orderId}`).emit('order_updated', updatedOrder);
  }
  logger.info('Food payment settled: order %s payment %s', orderId, paymentId);
  return settleResult('paid', updatedOrder);
}
exports.settleFoodPayment = settleFoodPayment;

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

  const r = await settleFoodPayment({ id, slug, razorpayOrderId: razorpay_order_id, paymentId: razorpay_payment_id, io: req.io });
  if (r.code !== 'paid') return fail(res, r.message, r.httpStatus);
  ok(res, { order: r.order }, r.message);
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

  // When switching to individual: reset item statuses to pending so the kitchen
  // sees a clean slate. Do NOT auto-accept — the kitchen must explicitly accept
  // or reject each item (or the whole order) before cooking can begin.
  if (mode === 'individual') {
    await db.query(
      "UPDATE order_items SET item_status = 'pending', accepted = false WHERE order_id = $1",
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
  // Items can be ticked in either kitchen mode — order-level advances cascade
  // to items (updateOrderStatus), so both stay in sync.
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
  // Starting to cook starts the ETA timer from the item's default prep time,
  // so the kitchen isn't prompted for every item (it can still override).
  const prepClause = status === 'preparing'
    ? `, prep_started_at = NOW(),
         prep_duration_mins = COALESCE(prep_duration_mins,
           (SELECT default_prep_mins FROM menu_items WHERE id = order_items.menu_item_id))`
    : '';
  const itemResult = await db.query(
    `UPDATE order_items SET item_status = $1${tsCol ? `, ${tsCol} = NOW()` : ''}${prepClause}
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

// ─── Owner/Staff: set prep time for a single item ─────────────────────────────
// Called when kitchen taps "Start cooking" on an item and enters duration.
// Sets prep_started_at = NOW() and prep_duration_mins = <input>.
// Broadcasts order_updated so KDS, cashier orders, and customer tracking all update.
exports.setItemPrepTime = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { prep_duration_mins } = req.body;

  const mins = parseInt(prep_duration_mins, 10);
  if (!mins || mins < 1 || mins > 300) return fail(res, 'prep_duration_mins must be 1–300', 400);

  const orderCheck = await db.query(
    'SELECT id, status FROM orders WHERE id = $1 AND cafe_id = $2',
    [id, req.cafeId]
  );
  if (orderCheck.rows.length === 0) return fail(res, 'Order not found', 404);
  if (['paid', 'cancelled'].includes(orderCheck.rows[0].status)) return fail(res, 'Order is already completed');

  const itemResult = await db.query(
    `UPDATE order_items
     SET prep_started_at = NOW(), prep_duration_mins = $1
     WHERE id = $2 AND order_id = $3
     RETURNING id, prep_started_at, prep_duration_mins`,
    [mins, itemId, id]
  );
  if (itemResult.rows.length === 0) return fail(res, 'Item not found', 404);

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
  refundPrepaidOrder(id, `Rejected: ${reason.trim()}`);

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
      `SELECT oi.id, oi.item_name, oi.quantity, oi.variant_name, oi.selected_modifiers
       FROM order_items oi
       WHERE oi.order_id = $1 AND oi.item_status != 'cancelled'
       ORDER BY oi.sort_order ASC, oi.id ASC`,
      [id]
    );
  } else {
    readyItems = await db.query(
      `SELECT oi.id, oi.item_name, oi.quantity, oi.variant_name, oi.selected_modifiers
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

// ─── Owner: send bill reminder to customer for a table ─────────
exports.remindBill = asyncHandler(async (req, res) => {
  const { tableNumber } = req.params;
  const { cafeId } = req;

  // Find all served (unpaid) orders on this table
  const result = await db.query(
    `SELECT id FROM orders
     WHERE cafe_id = $1 AND table_number = $2
       AND table_verified = true
       AND status IN ('served', 'ready', 'preparing', 'confirmed')
     ORDER BY created_at ASC`,
    [cafeId, tableNumber]
  );

  if (result.rows.length === 0) return fail(res, 'No active orders for this table', 404);

  // Emit bill_reminder socket event to each order's customer room
  result.rows.forEach(({ id }) => {
    req.io.to(`order:${id}`).emit('bill_reminder', { table_number: tableNumber });
  });

  ok(res, { notified: result.rows.length }, 'Reminder sent');
});

// ─── Table moves / confirmation ───────────────────────────────
// Moves the given open dine-in orders to a table, marks them verified and
// records where they came from (the KDS shows "Table 6 → 9" for a while).
async function moveOrdersToTable(client, cafeId, orderIds, table) {
  const r = await client.query(
    `UPDATE orders SET
       moved_from_table = CASE WHEN table_number IS DISTINCT FROM $3 THEN table_number ELSE moved_from_table END,
       moved_at         = CASE WHEN table_number IS DISTINCT FROM $3 THEN NOW() ELSE moved_at END,
       table_number     = $3,
       table_id         = $4,
       table_verified   = true,
       updated_at       = NOW()
     WHERE cafe_id = $1 AND id = ANY($2)
       AND order_type NOT IN ('takeaway', 'delivery')
       AND status NOT IN ('paid', 'cancelled')
     RETURNING id`,
    [cafeId, orderIds, table.label, table.id]
  );
  return r.rows.map((x) => x.id);
}

function emitTableChange(req, cafeId, ids, tableLabel) {
  if (!req.io) return;
  for (const id of ids) {
    const payload = { id, table_number: tableLabel, table_verified: true };
    req.io.to(`cafe:${cafeId}`).emit('order_updated', payload);
    req.io.to(`order:${id}`).emit('order_updated', payload);
  }
}

// Staff: confirm an order's table or move it (the whole party by default).
// body: { table_id }  — staff choose from the café's own tables.
exports.setOrderTable = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { table_id, scope = 'party' } = req.body;
  if (!table_id) return fail(res, 'table_id is required', 400);

  const t = await db.query(
    `SELECT t.id, t.label, a.name AS area_name FROM cafe_tables t
     LEFT JOIN areas a ON a.id = t.area_id
     WHERE t.id = $1 AND t.cafe_id = $2 AND t.is_active = true`,
    [table_id, req.cafeId]
  );
  if (!t.rows.length) return fail(res, 'Table not found', 404);
  const table = { id: t.rows[0].id, label: canonicalTableLabel(t.rows[0].label, t.rows[0].area_name) };

  const o = await db.query('SELECT id, party_id FROM orders WHERE id = $1 AND cafe_id = $2', [id, req.cafeId]);
  if (!o.rows.length) return fail(res, 'Order not found', 404);
  let orderIds = [id];
  if (scope === 'party' && o.rows[0].party_id) {
    const p = await db.query(
      `SELECT id FROM orders WHERE cafe_id = $1 AND party_id = $2 AND status NOT IN ('paid', 'cancelled')`,
      [req.cafeId, o.rows[0].party_id]
    );
    orderIds = p.rows.map((r) => r.id);
  }

  const moved = await moveOrdersToTable(db, req.cafeId, orderIds, table);
  if (!moved.length) return fail(res, 'Only open dine-in orders can be moved', 400);
  emitTableChange(req, req.cafeId, moved, table.label);
  logger.info('Staff %s set table %s for orders %s', req.staffId || req.cafeId, table.label, moved.join(','));
  ok(res, { table_number: table.label, order_ids: moved });
});

// Customer: "I moved to this table". Needs BOTH proofs — the order secrets
// (X-Order-Tokens, held only by the device that placed them) and the new
// table's QR token (only obtainable by scanning the QR on that table).
// Moves only those orders; nobody else's.
exports.customerMoveTable = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const cafeRes = await db.query('SELECT id FROM cafes WHERE slug = $1 AND is_active = true', [slug]);
  if (!cafeRes.rows.length) return fail(res, 'Café not found', 404);
  const cafeId = cafeRes.rows[0].id;

  const table = await tableFromQrToken(db, cafeId, req.body.table_token);
  if (!table) return fail(res, 'Please scan the QR code on your new table', 400);

  const tokens = sentOrderTokens(req);
  if (!tokens.length) return fail(res, 'No orders to move', 400);
  const mine = await db.query(
    `SELECT id FROM orders
     WHERE cafe_id = $1 AND customer_token = ANY($2)
       AND order_type NOT IN ('takeaway', 'delivery') AND status NOT IN ('paid', 'cancelled')`,
    [cafeId, tokens]
  );
  if (!mine.rows.length) return fail(res, 'No open orders to move', 404);

  const moved = await moveOrdersToTable(db, cafeId, mine.rows.map((r) => r.id), table);
  emitTableChange(req, cafeId, moved, table.label);
  logger.info('Customer moved orders %s to %s', moved.join(','), table.label);
  ok(res, { table_number: table.label, order_ids: moved }, `Moved to ${table.label}`);
});

// Public: which table does this QR token belong to? (label only)
exports.getTableByToken = asyncHandler(async (req, res) => {
  const cafeRes = await db.query('SELECT id FROM cafes WHERE slug = $1 AND is_active = true', [req.params.slug]);
  if (!cafeRes.rows.length) return fail(res, 'Café not found', 404);
  const table = await tableFromQrToken(db, cafeRes.rows[0].id, req.params.token);
  if (!table) return fail(res, 'Unknown table QR code', 404);
  ok(res, { table_number: table.label });
});
