const db           = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// ─── Owner: loyalty program config ───────────────────────────

exports.getProgram = asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM loyalty_programs WHERE cafe_id = $1`, [req.cafeId]
  );
  ok(res, { program: rows[0] || null });
});

exports.saveProgram = asyncHandler(async (req, res) => {
  const {
    points_per_rupee = 1, rupees_per_point = 0.1,
    min_points_redeem = 100, max_redeem_pct = 20,
    points_expiry_days = 365, is_active = true, program_name,
  } = req.body;

  const { rows } = await db.query(
    `INSERT INTO loyalty_programs
       (cafe_id, points_per_rupee, rupees_per_point, min_points_redeem,
        max_redeem_pct, points_expiry_days, is_active, program_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (cafe_id) DO UPDATE SET
       points_per_rupee   = EXCLUDED.points_per_rupee,
       rupees_per_point   = EXCLUDED.rupees_per_point,
       min_points_redeem  = EXCLUDED.min_points_redeem,
       max_redeem_pct     = EXCLUDED.max_redeem_pct,
       points_expiry_days = EXCLUDED.points_expiry_days,
       is_active          = EXCLUDED.is_active,
       program_name       = EXCLUDED.program_name,
       updated_at         = NOW()
     RETURNING *`,
    [req.cafeId, points_per_rupee, rupees_per_point, min_points_redeem,
     max_redeem_pct, points_expiry_days, is_active,
     program_name || 'Loyalty Points']
  );
  ok(res, { program: rows[0] }, 'Program saved');
});

// ─── Owner: customer points list ─────────────────────────────

exports.getCustomerPoints = asyncHandler(async (req, res) => {
  const { search = '', limit = 50, offset = 0 } = req.query;
  const q = `%${search.toLowerCase()}%`;
  const { rows } = await db.query(
    `SELECT customer_phone, customer_name, points_balance, total_earned, total_redeemed, last_activity
     FROM customer_points
     WHERE cafe_id = $1
       AND ($2 = '%%' OR LOWER(customer_name) LIKE $2 OR customer_phone LIKE $2)
     ORDER BY points_balance DESC
     LIMIT $3 OFFSET $4`,
    [req.cafeId, q, parseInt(limit), parseInt(offset)]
  );
  ok(res, { customers: rows });
});

exports.adjustPoints = asyncHandler(async (req, res) => {
  const { customer_phone, points, notes } = req.body;
  if (!customer_phone || points == null) return fail(res, 'customer_phone and points required', 400);
  const pts = parseInt(points);
  if (isNaN(pts) || pts === 0) return fail(res, 'points must be a non-zero integer', 400);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO customer_points (cafe_id, customer_phone, points_balance,
         total_earned, total_redeemed, last_activity)
       VALUES ($1,$2,GREATEST(0,$3),GREATEST(0,$3),0,NOW())
       ON CONFLICT (cafe_id, customer_phone) DO UPDATE SET
         points_balance = GREATEST(0, customer_points.points_balance + $3),
         total_earned   = CASE WHEN $3 > 0 THEN customer_points.total_earned + $3 ELSE customer_points.total_earned END,
         total_redeemed = CASE WHEN $3 < 0 THEN customer_points.total_redeemed + ABS($3) ELSE customer_points.total_redeemed END,
         last_activity  = NOW()`,
      [req.cafeId, customer_phone, pts]
    );
    await client.query(
      `INSERT INTO loyalty_transactions (cafe_id, customer_phone, type, points, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.cafeId, customer_phone, pts > 0 ? 'adjustment' : 'adjustment', pts, notes || 'Manual adjustment']
    );
    await client.query('COMMIT');
    const bal = await db.query(
      `SELECT points_balance FROM customer_points WHERE cafe_id=$1 AND customer_phone=$2`,
      [req.cafeId, customer_phone]
    );
    ok(res, { points_balance: bal.rows[0]?.points_balance || 0 }, 'Points adjusted');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// ─── Public (customer-facing): check points balance ──────────

exports.getBalance = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { phone } = req.query;
  if (!phone) return fail(res, 'phone is required', 400);

  const [cafeRes, balRes, programRes] = await Promise.all([
    db.query(`SELECT id FROM cafes WHERE slug = $1`, [slug]),
    db.query(
      `SELECT cp.points_balance, cp.total_earned, cp.total_redeemed
       FROM customer_points cp JOIN cafes c ON c.id = cp.cafe_id
       WHERE c.slug = $1 AND cp.customer_phone = $2`,
      [slug, phone]
    ),
    db.query(
      `SELECT lp.points_per_rupee, lp.rupees_per_point, lp.min_points_redeem,
              lp.max_redeem_pct, lp.program_name, lp.is_active
       FROM loyalty_programs lp JOIN cafes c ON c.id = lp.cafe_id
       WHERE c.slug = $1`,
      [slug]
    ),
  ]);
  if (!cafeRes.rows.length) return fail(res, 'Café not found', 404);
  if (!programRes.rows.length || !programRes.rows[0].is_active) {
    return ok(res, { active: false });
  }

  const program = programRes.rows[0];
  const balance = balRes.rows[0];
  ok(res, {
    active: true,
    program_name: program.program_name,
    points_balance:  balance?.points_balance  || 0,
    total_earned:    balance?.total_earned    || 0,
    total_redeemed:  balance?.total_redeemed  || 0,
    points_per_rupee: parseFloat(program.points_per_rupee),
    rupees_per_point: parseFloat(program.rupees_per_point),
    min_points_redeem: program.min_points_redeem,
    max_redeem_pct:    program.max_redeem_pct,
  });
});

// ─── Internal: earn points after order paid ──────────────────

exports.earnPoints = async (cafeId, orderId, customerPhone, orderAmount) => {
  if (!customerPhone) return;
  try {
    const progRes = await db.query(
      `SELECT points_per_rupee FROM loyalty_programs WHERE cafe_id=$1 AND is_active=true`, [cafeId]
    );
    if (!progRes.rows.length) return;
    const ppr = parseFloat(progRes.rows[0].points_per_rupee);
    const earned = Math.floor(parseFloat(orderAmount) * ppr);
    if (earned <= 0) return;

    await db.query(
      `INSERT INTO customer_points (cafe_id, customer_phone, points_balance, total_earned, last_activity)
       VALUES ($1,$2,$3,$3,NOW())
       ON CONFLICT (cafe_id, customer_phone) DO UPDATE SET
         points_balance = customer_points.points_balance + $3,
         total_earned   = customer_points.total_earned + $3,
         last_activity  = NOW()`,
      [cafeId, customerPhone, earned]
    );
    await db.query(
      `INSERT INTO loyalty_transactions (cafe_id, customer_phone, order_id, type, points, order_amount)
       VALUES ($1,$2,$3,'earn',$4,$5)`,
      [cafeId, customerPhone, orderId, earned, orderAmount]
    );
    await db.query(
      `UPDATE orders SET loyalty_points_earned = $1 WHERE id = $2`,
      [earned, orderId]
    );
  } catch (e) {
    require('../utils/logger').warn('Failed to earn loyalty points: %s', e.message);
  }
};

// ─── Owner: transaction history for a customer ───────────────

exports.getTransactions = asyncHandler(async (req, res) => {
  const { phone } = req.params;
  const { rows } = await db.query(
    `SELECT lt.*, o.daily_order_number
     FROM loyalty_transactions lt
     LEFT JOIN orders o ON o.id = lt.order_id
     WHERE lt.cafe_id = $1 AND lt.customer_phone = $2
     ORDER BY lt.created_at DESC LIMIT 50`,
    [req.cafeId, phone]
  );
  ok(res, { transactions: rows });
});
