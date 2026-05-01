const db           = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// ─── Open a new shift ─────────────────────────────────────────

exports.openShift = asyncHandler(async (req, res) => {
  const { opening_balance = 0, notes } = req.body;

  // Check no shift is already open
  const existing = await db.query(
    `SELECT id FROM shifts WHERE cafe_id = $1 AND status = 'open' LIMIT 1`,
    [req.cafeId]
  );
  if (existing.rows.length) return fail(res, 'A shift is already open. Close it first.', 409);

  const staffId = req.staffId || null;
  const { rows } = await db.query(
    `INSERT INTO shifts (cafe_id, opened_by, opening_balance, notes, status)
     VALUES ($1, $2, $3, $4, 'open')
     RETURNING *`,
    [req.cafeId, staffId, parseFloat(opening_balance) || 0, notes || null]
  );
  ok(res, { shift: rows[0] }, 'Shift opened');
});

// ─── Close current shift ──────────────────────────────────────

exports.closeShift = asyncHandler(async (req, res) => {
  const { closing_balance, notes } = req.body;
  if (closing_balance == null) return fail(res, 'closing_balance is required', 400);

  const shiftRes = await db.query(
    `SELECT * FROM shifts WHERE cafe_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
    [req.cafeId]
  );
  if (!shiftRes.rows.length) return fail(res, 'No open shift found', 404);
  const shift = shiftRes.rows[0];

  // Aggregate order totals since shift opened
  const totals = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'paid')                                      AS total_orders,
       COALESCE(SUM(final_amount) FILTER (WHERE status = 'paid'), 0)                AS total_revenue,
       COALESCE(SUM(final_amount) FILTER (WHERE status='paid' AND payment_method='cash'), 0)  AS cash_sales,
       COALESCE(SUM(final_amount) FILTER (WHERE status='paid' AND payment_method='card'), 0)  AS card_sales,
       COALESCE(SUM(final_amount) FILTER (WHERE status='paid' AND payment_method='upi'), 0)   AS upi_sales,
       COALESCE(SUM(final_amount) FILTER (WHERE status='paid' AND payment_method NOT IN ('cash','card','upi') AND payment_method IS NOT NULL), 0) AS other_sales,
       COALESCE(SUM(discount_amount) FILTER (WHERE status = 'paid'), 0)             AS total_discounts
     FROM orders
     WHERE cafe_id = $1 AND created_at >= $2`,
    [req.cafeId, shift.opened_at]
  );
  const t = totals.rows[0];

  const expectedCash = parseFloat(shift.opening_balance) + parseFloat(t.cash_sales);
  const staffId = req.staffId || null;

  const { rows } = await db.query(
    `UPDATE shifts SET
       status          = 'closed',
       closed_by       = $1,
       closing_balance = $2,
       expected_cash   = $3,
       cash_sales      = $4,
       card_sales      = $5,
       upi_sales       = $6,
       other_sales     = $7,
       total_orders    = $8,
       total_revenue   = $9,
       total_discounts = $10,
       notes           = COALESCE($11, notes),
       closed_at       = NOW()
     WHERE id = $12
     RETURNING *`,
    [staffId, parseFloat(closing_balance), expectedCash,
     t.cash_sales, t.card_sales, t.upi_sales, t.other_sales,
     parseInt(t.total_orders), t.total_revenue, t.total_discounts,
     notes || null, shift.id]
  );

  ok(res, { shift: rows[0] }, 'Shift closed');
});

// ─── Get current open shift ───────────────────────────────────

exports.getCurrentShift = asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.*,
            -- Live order counts since this shift opened
            COUNT(o.id) FILTER (WHERE o.status = 'paid')                         AS live_orders,
            COALESCE(SUM(o.final_amount) FILTER (WHERE o.status = 'paid'), 0)    AS live_revenue,
            COALESCE(SUM(o.final_amount) FILTER (WHERE o.status='paid' AND o.payment_method='cash'), 0) AS live_cash
     FROM shifts s
     LEFT JOIN orders o ON o.cafe_id = s.cafe_id AND o.created_at >= s.opened_at
     WHERE s.cafe_id = $1 AND s.status = 'open'
     GROUP BY s.id
     ORDER BY s.opened_at DESC LIMIT 1`,
    [req.cafeId]
  );
  ok(res, { shift: rows[0] || null });
});

// ─── Shift history ────────────────────────────────────────────

exports.getShifts = asyncHandler(async (req, res) => {
  const { limit = 30, offset = 0 } = req.query;
  const { rows } = await db.query(
    `SELECT s.*,
            opener.name AS opened_by_name,
            closer.name AS closed_by_name
     FROM shifts s
     LEFT JOIN cafe_staff opener ON opener.id = s.opened_by
     LEFT JOIN cafe_staff closer ON closer.id = s.closed_by
     WHERE s.cafe_id = $1
     ORDER BY s.opened_at DESC
     LIMIT $2 OFFSET $3`,
    [req.cafeId, parseInt(limit), parseInt(offset)]
  );
  ok(res, { shifts: rows });
});

// ─── Get shift summary (for a closed shift) ──────────────────

exports.getShiftSummary = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const shiftRes = await db.query(
    `SELECT s.*, opener.name AS opened_by_name, closer.name AS closed_by_name
     FROM shifts s
     LEFT JOIN cafe_staff opener ON opener.id = s.opened_by
     LEFT JOIN cafe_staff closer ON closer.id = s.closed_by
     WHERE s.id = $1 AND s.cafe_id = $2`,
    [id, req.cafeId]
  );
  if (!shiftRes.rows.length) return fail(res, 'Shift not found', 404);
  const shift = shiftRes.rows[0];

  const topItems = await db.query(
    `SELECT oi.item_name, SUM(oi.quantity) AS qty, SUM(oi.subtotal) AS revenue
     FROM orders o JOIN order_items oi ON oi.order_id = o.id
     WHERE o.cafe_id = $1 AND o.status = 'paid'
       AND o.created_at BETWEEN $2 AND COALESCE($3, NOW())
     GROUP BY oi.item_name ORDER BY qty DESC LIMIT 5`,
    [req.cafeId, shift.opened_at, shift.closed_at]
  );

  ok(res, { shift, top_items: topItems.rows });
});
