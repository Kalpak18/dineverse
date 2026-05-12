const db = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// ─── Admin: list all platform offers ─────────────────────────────

exports.getPlatformOffers = asyncHandler(async (req, res) => {
  const { active } = req.query;
  const { rows } = await db.query(
    `SELECT po.*,
            COUNT(poc.cafe_id)::int AS targeted_cafes,
            po.uses_count
     FROM platform_offers po
     LEFT JOIN platform_offer_cafes poc ON poc.platform_offer_id = po.id
     ${active === 'true' ? 'WHERE po.is_active = true' : ''}
     GROUP BY po.id
     ORDER BY po.created_at DESC`
  );
  ok(res, { offers: rows });
});

// ─── Admin: get one platform offer with targeted cafes list ───────

exports.getPlatformOffer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [offerRes, cafesRes] = await Promise.all([
    db.query('SELECT * FROM platform_offers WHERE id = $1', [id]),
    db.query(
      `SELECT c.id, c.name, c.slug, c.city
       FROM platform_offer_cafes poc
       JOIN cafes c ON c.id = poc.cafe_id
       WHERE poc.platform_offer_id = $1`,
      [id]
    ),
  ]);
  if (!offerRes.rows.length) return fail(res, 'Offer not found', 404);
  ok(res, { offer: offerRes.rows[0], targeted_cafes: cafesRes.rows });
});

// ─── Admin: create platform offer ────────────────────────────────

exports.createPlatformOffer = asyncHandler(async (req, res) => {
  const {
    name, description, offer_type, discount_value, max_discount_amount,
    coupon_code, min_order_amount, target_type, cafe_ids,
    active_days, active_from, active_until, start_date, end_date, max_uses,
  } = req.body;

  if (!name?.trim()) return fail(res, 'Offer name is required');
  if (!['percentage', 'fixed', 'first_order'].includes(offer_type))
    return fail(res, 'offer_type must be percentage, fixed, or first_order');

  const parsedDiscount = parseFloat(discount_value) || 0;
  if (offer_type === 'percentage' && (parsedDiscount < 1 || parsedDiscount > 100))
    return fail(res, 'Percentage must be 1–100');
  if (offer_type === 'fixed' && parsedDiscount <= 0)
    return fail(res, 'Fixed discount must be positive');

  const tgt = target_type || 'all';
  if (tgt === 'specific' && (!Array.isArray(cafe_ids) || cafe_ids.length === 0))
    return fail(res, 'Provide cafe_ids for specific targeting');

  const normalizedCode = coupon_code?.trim().toUpperCase() || null;

  const { rows } = await db.query(
    `INSERT INTO platform_offers
       (name, description, offer_type, discount_value, max_discount_amount,
        coupon_code, min_order_amount, target_type,
        active_days, active_from, active_until, start_date, end_date, max_uses)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      name.trim(), description || null, offer_type, parsedDiscount,
      max_discount_amount ? parseFloat(max_discount_amount) : null,
      normalizedCode, parseFloat(min_order_amount) || 0, tgt,
      active_days || null, active_from || null, active_until || null,
      start_date || null, end_date || null,
      max_uses ? parseInt(max_uses) : null,
    ]
  );
  const offer = rows[0];

  if (tgt === 'specific' && cafe_ids?.length) {
    await db.query(
      `INSERT INTO platform_offer_cafes (platform_offer_id, cafe_id)
       SELECT $1, UNNEST($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [offer.id, cafe_ids]
    );
  }

  ok(res, { offer }, 'Platform offer created', 201);
});

// ─── Admin: update platform offer ────────────────────────────────

exports.updatePlatformOffer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name, description, offer_type, discount_value, max_discount_amount,
    coupon_code, min_order_amount, target_type, cafe_ids,
    active_days, active_from, active_until, start_date, end_date, max_uses, is_active,
  } = req.body;

  const { rows } = await db.query(
    `UPDATE platform_offers SET
       name                = COALESCE($1,  name),
       description         = COALESCE($2,  description),
       offer_type          = COALESCE($3,  offer_type),
       discount_value      = COALESCE($4,  discount_value),
       max_discount_amount = COALESCE($5,  max_discount_amount),
       coupon_code         = COALESCE($6,  coupon_code),
       min_order_amount    = COALESCE($7,  min_order_amount),
       target_type         = COALESCE($8,  target_type),
       active_days         = COALESCE($9,  active_days),
       active_from         = COALESCE($10, active_from),
       active_until        = COALESCE($11, active_until),
       start_date          = COALESCE($12, start_date),
       end_date            = COALESCE($13, end_date),
       max_uses            = COALESCE($14, max_uses),
       is_active           = COALESCE($15, is_active),
       updated_at          = NOW()
     WHERE id = $16
     RETURNING *`,
    [
      name || null, description || null, offer_type || null,
      discount_value != null ? parseFloat(discount_value) : null,
      max_discount_amount != null ? parseFloat(max_discount_amount) : null,
      coupon_code?.trim().toUpperCase() || null,
      min_order_amount != null ? parseFloat(min_order_amount) : null,
      target_type || null, active_days || null, active_from || null, active_until || null,
      start_date || null, end_date || null,
      max_uses != null ? parseInt(max_uses) : null,
      is_active != null ? is_active : null, id,
    ]
  );
  if (!rows.length) return fail(res, 'Offer not found', 404);

  // Update café targeting if provided
  if (cafe_ids !== undefined) {
    await db.query('DELETE FROM platform_offer_cafes WHERE platform_offer_id = $1', [id]);
    if (rows[0].target_type === 'specific' && cafe_ids.length > 0) {
      await db.query(
        `INSERT INTO platform_offer_cafes (platform_offer_id, cafe_id)
         SELECT $1, UNNEST($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [id, cafe_ids]
      );
    }
  }

  ok(res, { offer: rows[0] });
});

// ─── Admin: delete platform offer ────────────────────────────────

exports.deletePlatformOffer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query(
    'DELETE FROM platform_offers WHERE id = $1 RETURNING id', [id]
  );
  if (!rows.length) return fail(res, 'Offer not found', 404);
  ok(res, {}, 'Platform offer deleted');
});

// ─── Admin: list ALL owner-created offers across every café ─────
// Read-only inventory view. Admin can toggle active/inactive (e.g. to disable
// a misleading offer) but cannot edit the offer's content — that stays with
// the café owner who created it.
exports.adminListOwnerOffers = asyncHandler(async (req, res) => {
  const { cafe_id, active } = req.query;
  const params = [];
  const where = [];
  if (cafe_id) { params.push(cafe_id); where.push(`o.cafe_id = $${params.length}`); }
  if (active === 'true')  where.push('o.is_active = true');
  if (active === 'false') where.push('o.is_active = false');

  const sql = `
    SELECT o.id, o.cafe_id, o.name, o.description, o.offer_type,
           o.discount_value, o.combo_price, o.coupon_code,
           o.min_order_amount, o.max_discount_amount, o.max_uses, o.uses_count,
           o.start_date, o.end_date, o.is_active, o.created_at,
           c.name AS cafe_name, c.slug AS cafe_slug, c.city AS cafe_city
    FROM offers o
    JOIN cafes c ON c.id = o.cafe_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.created_at DESC
    LIMIT 500
  `;
  const { rows } = await db.query(sql, params);
  ok(res, { offers: rows });
});

// ─── Admin: toggle active flag on an owner offer ─────────────────
// Used to quickly disable a misleading or fraudulent offer without removing it.
// Admin actions are audited via logger so the café owner can see why.
exports.adminToggleOwnerOffer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  if (typeof is_active !== 'boolean') return fail(res, 'is_active (boolean) required', 400);

  const { rows } = await db.query(
    `UPDATE offers SET is_active = $1 WHERE id = $2
     RETURNING id, name, cafe_id, is_active`,
    [is_active, id]
  );
  if (!rows.length) return fail(res, 'Offer not found', 404);

  // Audit trail
  const logger = require('../utils/logger');
  logger.warn('Admin toggled owner offer %s (cafe %s) to is_active=%s',
    rows[0].name, rows[0].cafe_id, is_active);

  ok(res, { offer: rows[0] }, `Offer ${is_active ? 'activated' : 'paused'}`);
});

// ─── Admin: get usage / redemption stats for a platform offer ─────

exports.getPlatformOfferStats = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int                             AS total_redemptions,
       COUNT(DISTINCT cafe_id)::int              AS cafes_used,
       COALESCE(SUM(platform_discount_amount), 0) AS total_discount_given,
       DATE_TRUNC('day', created_at AT TIME ZONE 'Asia/Kolkata') AS day,
       COUNT(*)::int                             AS daily_count
     FROM orders
     WHERE platform_offer_id = $1 AND status = 'paid'
     GROUP BY day
     ORDER BY day DESC
     LIMIT 30`,
    [id]
  );
  const totals = await db.query(
    `SELECT COUNT(*)::int AS total, COALESCE(SUM(platform_discount_amount),0) AS total_discount
     FROM orders WHERE platform_offer_id = $1 AND status = 'paid'`,
    [id]
  );
  ok(res, {
    total_redemptions:  totals.rows[0]?.total ?? 0,
    total_discount:     parseFloat(totals.rows[0]?.total_discount ?? 0),
    daily_breakdown:    rows,
  });
});
