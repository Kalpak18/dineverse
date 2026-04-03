const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const logger = require('../utils/logger');
const { ok, fail, validationFail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const { createOtp, verifyOtp } = require('../utils/otpStore');
const { sendPasswordResetEmail } = require('../services/emailService');

const generateAdminToken = (adminId) =>
  jwt.sign({ adminId, role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '30d' });

// ─── POST /api/admin/setup (one-time, only when no admins exist) ─
exports.setup = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return fail(res, 'name, email and password are required');
  if (password.length < 8) return fail(res, 'Password must be at least 8 characters');

  const existing = await db.query('SELECT COUNT(*) FROM developers');
  if (parseInt(existing.rows[0].count) > 0) {
    return fail(res, 'Admin already exists. Use login instead.', 409);
  }

  const password_hash = await bcrypt.hash(password, 12);
  const result = await db.query(
    `INSERT INTO developers (name, email, password_hash)
     VALUES ($1, $2, $3) RETURNING id, name, email, created_at`,
    [name, email.toLowerCase(), password_hash]
  );
  const admin = result.rows[0];
  const token = generateAdminToken(admin.id);
  logger.info('Developer admin created: %s', admin.email);
  ok(res, { token, admin }, 'Admin account created', 201);
});

// ─── POST /api/admin/login ────────────────────────────────────
exports.validateLogin = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
];

exports.login = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { email, password } = req.body;
  const result = await db.query(
    'SELECT * FROM developers WHERE email = $1 AND is_active = true',
    [email]
  );
  if (result.rows.length === 0) return fail(res, 'Invalid credentials', 401);

  const admin = result.rows[0];
  const isValid = await bcrypt.compare(password, admin.password_hash);
  if (!isValid) return fail(res, 'Invalid credentials', 401);

  const token = generateAdminToken(admin.id);
  const { password_hash, ...adminData } = admin;
  logger.info('Admin login: %s', admin.email);
  ok(res, { token, admin: adminData }, 'Login successful');
});

// ─── GET /api/admin/me ────────────────────────────────────────
exports.getMe = asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT id, name, email, created_at FROM developers WHERE id = $1',
    [req.adminId]
  );
  if (result.rows.length === 0) return fail(res, 'Admin not found', 404);
  ok(res, { admin: result.rows[0] });
});

// ─── GET /api/admin/dashboard ────────────────────────────────
exports.getDashboard = asyncHandler(async (req, res) => {
  const [cafeStats, revenueStats, ticketStats, recentPayments, recentSignups] = await Promise.all([
    // Cafe counts
    db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE plan_type = 'free_trial' AND plan_expiry_date > NOW()) AS active_trials,
        COUNT(*) FILTER (WHERE plan_type = 'yearly' AND plan_expiry_date > NOW())     AS active_paid,
        COUNT(*) FILTER (WHERE plan_expiry_date < NOW())                              AS expired,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')             AS new_this_month
      FROM cafes WHERE is_active = true
    `),
    // Revenue
    db.query(`
      SELECT
        COALESCE(SUM(amount_paise) FILTER (WHERE status='completed'), 0) AS total_paise,
        COALESCE(SUM(amount_paise) FILTER (WHERE status='completed'
          AND created_at >= DATE_TRUNC('month', NOW())), 0)               AS this_month_paise,
        COUNT(*) FILTER (WHERE status='completed')                        AS total_payments
      FROM payments
    `),
    // Tickets
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open')        AS open,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved')    AS resolved
      FROM support_tickets
    `),
    // Recent payments
    db.query(`
      SELECT p.id, p.amount_paise, p.plan_type, p.status, p.created_at,
             c.name AS cafe_name, c.email AS cafe_email
      FROM payments p
      JOIN cafes c ON p.cafe_id = c.id
      WHERE p.status = 'completed'
      ORDER BY p.created_at DESC LIMIT 5
    `),
    // Recent signups
    db.query(`
      SELECT id, name, email, plan_type, plan_expiry_date, created_at
      FROM cafes ORDER BY created_at DESC LIMIT 5
    `),
  ]);

  const rev = revenueStats.rows[0];
  ok(res, {
    cafes: cafeStats.rows[0],
    revenue: {
      total_rupees: parseInt(rev.total_paise) / 100,
      this_month_rupees: parseInt(rev.this_month_paise) / 100,
      total_payments: parseInt(rev.total_payments),
    },
    tickets: ticketStats.rows[0],
    recent_payments: recentPayments.rows.map((p) => ({
      ...p,
      amount_rupees: p.amount_paise / 100,
    })),
    recent_signups: recentSignups.rows,
  });
});

// ─── GET /api/admin/cafes ─────────────────────────────────────
exports.getCafes = asyncHandler(async (req, res) => {
  const { search, plan, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = 'WHERE 1=1';
  const params = [];
  let idx = 1;

  if (search) {
    where += ` AND (c.name ILIKE $${idx} OR c.email ILIKE $${idx} OR c.slug ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }
  if (plan) {
    where += ` AND c.plan_type = $${idx++}`;
    params.push(plan);
  }

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM cafes c ${where}`, params),
    db.query(
      `SELECT c.id, c.name, c.email, c.slug, c.phone, c.is_active,
              c.plan_type, c.plan_start_date, c.plan_expiry_date, c.created_at,
              (SELECT COUNT(*) FROM orders o WHERE o.cafe_id = c.id)   AS total_orders,
              (SELECT COUNT(*) FROM menu_items m WHERE m.cafe_id = c.id) AS menu_items
       FROM cafes c ${where}
       ORDER BY c.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit), offset]
    ),
  ]);

  ok(res, {
    cafes: rowsRes.rows,
    total: parseInt(countRes.rows[0].count),
    page: parseInt(page),
    limit: parseInt(limit),
  });
});

// ─── PATCH /api/admin/cafes/:id ───────────────────────────────
exports.updateCafe = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { is_active, extend_months } = req.body;

  if (extend_months) {
    // Extend plan from today or current expiry (whichever is later)
    await db.query(
      `UPDATE cafes
       SET plan_type         = 'yearly',
           plan_expiry_date  = GREATEST(plan_expiry_date, NOW()) + ($1 || ' months')::INTERVAL
       WHERE id = $2`,
      [parseInt(extend_months), id]
    );
  }

  if (is_active !== undefined) {
    await db.query('UPDATE cafes SET is_active = $1 WHERE id = $2', [is_active, id]);
  }

  const result = await db.query(
    'SELECT id, name, email, is_active, plan_type, plan_expiry_date FROM cafes WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) return fail(res, 'Café not found', 404);
  ok(res, { cafe: result.rows[0] }, 'Café updated');
});

// ─── GET /api/admin/revenue ───────────────────────────────────
exports.getRevenue = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  let where = "WHERE p.status = 'completed'";
  const params = [];
  let idx = 1;
  if (from) { where += ` AND p.created_at >= $${idx++}`; params.push(from); }
  if (to)   { where += ` AND p.created_at <= $${idx++}`; params.push(to + ' 23:59:59'); }

  const [payments, monthly] = await Promise.all([
    db.query(
      `SELECT p.id, p.razorpay_payment_id, p.amount_paise, p.plan_type, p.created_at,
              c.name AS cafe_name, c.email AS cafe_email
       FROM payments p JOIN cafes c ON p.cafe_id = c.id
       ${where}
       ORDER BY p.created_at DESC`,
      params
    ),
    db.query(`
      SELECT DATE_TRUNC('month', created_at) AS month,
             COUNT(*) AS count,
             SUM(amount_paise) AS total_paise
      FROM payments
      WHERE status = 'completed'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
      LIMIT 12
    `),
  ]);

  ok(res, {
    payments: payments.rows.map((p) => ({ ...p, amount_rupees: p.amount_paise / 100 })),
    monthly_breakdown: monthly.rows.map((m) => ({
      month: m.month,
      count: parseInt(m.count),
      total_rupees: parseInt(m.total_paise) / 100,
    })),
  });
});

// ─── GET /api/admin/tickets ───────────────────────────────────
exports.getTickets = asyncHandler(async (req, res) => {
  const { status } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (status) { where += ' AND status = $1'; params.push(status); }

  const result = await db.query(
    `SELECT id, cafe_id, cafe_name, cafe_email, subject, message,
            status, admin_reply, replied_at, created_at, updated_at
     FROM support_tickets ${where}
     ORDER BY
       CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
       created_at DESC`,
    params
  );
  ok(res, { tickets: result.rows });
});

// ─── PATCH /api/admin/tickets/:id ────────────────────────────
exports.replyTicket = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { admin_reply, status } = req.body;
  if (!admin_reply && !status) return fail(res, 'Provide admin_reply or status');

  const result = await db.query(
    `UPDATE support_tickets
     SET admin_reply = COALESCE($1, admin_reply),
         replied_at  = CASE WHEN $1 IS NOT NULL THEN NOW() ELSE replied_at END,
         status      = COALESCE($2, status)
     WHERE id = $3
     RETURNING *`,
    [admin_reply || null, status || null, id]
  );
  if (result.rows.length === 0) return fail(res, 'Ticket not found', 404);

  // Notify cafe owner via socket if connected
  if (req.io && result.rows[0].cafe_id) {
    req.io.to(`cafe:${result.rows[0].cafe_id}`).emit('ticket_reply', {
      ticket_id: id,
      admin_reply: result.rows[0].admin_reply,
      status: result.rows[0].status,
    });
  }

  ok(res, { ticket: result.rows[0] }, 'Ticket updated');
});

// ─── GET /api/admin/analytics ─────────────────────────────────
exports.getAnalytics = asyncHandler(async (req, res) => {
  const [signupsByMonth, planDist, topCafes, expiringCafes] = await Promise.all([
    // New signups per month (last 12)
    db.query(`
      SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*) AS count
      FROM cafes
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC LIMIT 12
    `),
    // Plan distribution
    db.query(`
      SELECT plan_type,
             COUNT(*) AS count,
             COUNT(*) FILTER (WHERE plan_expiry_date > NOW()) AS active
      FROM cafes GROUP BY plan_type
    `),
    // Top cafes by orders
    db.query(`
      SELECT c.id, c.name, c.email, c.plan_type, c.plan_expiry_date,
             COUNT(o.id) AS total_orders,
             COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='paid'), 0) AS total_revenue
      FROM cafes c
      LEFT JOIN orders o ON o.cafe_id = c.id
      GROUP BY c.id, c.name, c.email, c.plan_type, c.plan_expiry_date
      ORDER BY total_orders DESC LIMIT 10
    `),
    // Expiring soon (next 7 days)
    db.query(`
      SELECT id, name, email, plan_type, plan_expiry_date
      FROM cafes
      WHERE plan_expiry_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        AND is_active = true
      ORDER BY plan_expiry_date ASC
    `),
  ]);

  ok(res, {
    signups_by_month: signupsByMonth.rows,
    plan_distribution: planDist.rows,
    top_cafes: topCafes.rows,
    expiring_soon: expiringCafes.rows,
  });
});

// ─── POST /api/admin/forgot-password ──────────────────────────
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(res, 'Valid email is required');
  }
  const result = await db.query(
    'SELECT id FROM developers WHERE email = $1 AND is_active = true',
    [email.toLowerCase()]
  );
  if (result.rows.length === 0) {
    return fail(res, 'No admin account found with this email', 404);
  }
  const otp = await createOtp(email, 'admin_reset');
  await sendPasswordResetEmail(email, otp);
  ok(res, {}, 'Reset code sent to your admin email');
});

// ─── POST /api/admin/reset-password ───────────────────────────
exports.validateResetPassword = [
  body('email').isEmail().normalizeEmail(),
  body('otp').trim().notEmpty(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

exports.resetPassword = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { email, otp, password } = req.body;
  const otpCheck = await verifyOtp(email, otp, 'admin_reset');
  if (!otpCheck.valid) return fail(res, otpCheck.reason);

  const password_hash = await bcrypt.hash(password, 12);
  const result = await db.query(
    'UPDATE developers SET password_hash = $1 WHERE email = $2 AND is_active = true RETURNING id',
    [password_hash, email.toLowerCase()]
  );
  if (result.rowCount === 0) return fail(res, 'Admin account not found', 404);

  logger.info('Admin password reset: %s', email);
  ok(res, {}, 'Password updated — you can now log in');
});
