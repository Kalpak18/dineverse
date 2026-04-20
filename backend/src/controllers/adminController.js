const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const logger = require('../utils/logger');
const { ok, fail, validationFail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const { createOtp, verifyOtp } = require('../utils/otpStore');
const { sendPasswordResetEmail, sendBroadcastEmail } = require('../services/emailService');

const generateAdminToken = (adminId) =>
  jwt.sign({ adminId, role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '30d' });

// ─── POST /api/admin/setup (one-time, only when no admins exist) ─
exports.setup = asyncHandler(async (req, res) => {
  if (process.env.ADMIN_SETUP_ENABLED !== 'true') {
    return fail(res, 'Setup is disabled. Set ADMIN_SETUP_ENABLED=true to enable.', 403);
  }

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

  // Check if SMTP is configured
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.error('SMTP not configured - cannot send admin password reset email');
    return fail(res, 'Email service is not configured. Please contact support.');
  }

  const result = await db.query(
    'SELECT id FROM developers WHERE email = $1 AND is_active = true',
    [email.toLowerCase()]
  );
  if (result.rows.length === 0) {
    return fail(res, 'No admin account found with this email', 404);
  }

  try {
    const otp = await createOtp(email, 'admin_reset');
    await sendPasswordResetEmail(email, otp);
    ok(res, {}, 'Reset code sent to your admin email');
  } catch (error) {
    logger.error('Failed to send admin password reset email:', error.message);
    return fail(res, 'Failed to send password reset email. Please try again later.');
  }
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

// ─── GET /api/admin/settings ──────────────────────────────────
// Get all platform settings (admin only)
exports.getSettings = asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT key, value, description, is_public, updated_at, updated_by
     FROM platform_settings
     ORDER BY updated_at DESC`
  );
  ok(res, { settings: result.rows });
});

// ─── GET /api/admin/public-settings/:key ──────────────────────
// Public endpoint — retrieve public settings by key (no auth)
exports.getPublicSetting = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const result = await db.query(
    `SELECT value FROM platform_settings
     WHERE key = $1 AND is_public = true`,
    [key]
  );
  if (result.rows.length === 0) {
    return fail(res, 'Setting not found or not public', 404);
  }
  let value = result.rows[0].value;
  // If value is a string, parse JSON; otherwise it is already JSON object/value
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (e) {
      // Keep as string
    }
  }
  ok(res, { key, value });
});

// ─── PUT /api/admin/settings/:key ────────────────────────────
// Update a platform setting by key
exports.updateSetting = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { value, description, is_public } = req.body;

  if (!value) {
    return fail(res, 'value is required');
  }

  // Store value as JSONB; PostgreSQL handles JSON encoding
  const valueToStore = typeof value === 'object' ? value : JSON.parse(value);

  const result = await db.query(
    `INSERT INTO platform_settings (key, value, description, is_public, updated_by, updated_at)
     VALUES ($1, $2::JSONB, $3, COALESCE($4, false), $5, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value = $2::JSONB,
       description = COALESCE($3, platform_settings.description),
       is_public = COALESCE($4, platform_settings.is_public),
       updated_by = $5,
       updated_at = NOW()
     RETURNING key, value, description, is_public, updated_at`,
    [key, valueToStore, description || null, is_public || null, req.adminId]
  );

  logger.info('Admin updated setting: %s', key);
  ok(res, { setting: result.rows[0] }, 'Setting updated');
});

// ─── GET /api/admin/cafes/:id/stats ───────────────────────────
// Deep-dive statistics for a specific cafe
exports.getCafeStats = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [cafe, orders, revenue, menuStats, ratings] = await Promise.all([
    // Cafe details
    db.query(
      `SELECT id, name, email, slug, phone, is_active, plan_type, plan_start_date, plan_expiry_date, created_at
       FROM cafes WHERE id = $1`,
      [id]
    ),
    // Orders: total count + status breakdown
    db.query(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
        COUNT(*) FILTER (WHERE status = 'preparing') AS preparing,
        COUNT(*) FILTER (WHERE status = 'ready') AS ready,
        COUNT(*) FILTER (WHERE status = 'served') AS served,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
       FROM orders WHERE cafe_id = $1`,
      [id]
    ),
    // Revenue: total + breakdown by status
    db.query(
      `SELECT
        COALESCE(SUM(total_amount), 0) AS total_revenue,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0) AS revenue_paid,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'pending'), 0) AS revenue_pending,
        COUNT(*) FILTER (WHERE status = 'paid') AS completed_orders
       FROM orders WHERE cafe_id = $1`,
      [id]
    ),
    // Menu: categories and item count
    db.query(
      `SELECT
        COUNT(*) FILTER (WHERE m.is_available = true) AS available_items,
        COUNT(*) AS total_items,
        COUNT(DISTINCT m.category_id) AS total_categories
       FROM menu_items m WHERE m.cafe_id = $1`,
      [id]
    ),
    // Ratings: average + count
    db.query(
      `SELECT
        COALESCE(AVG(rating), 0)::numeric(3,2) AS avg_rating,
        COUNT(*) AS total_ratings
       FROM order_ratings WHERE cafe_id = $1`,
      [id]
    ),
  ]);

  if (cafe.rows.length === 0) {
    return fail(res, 'Café not found', 404);
  }

  const o = orders.rows[0];
  const r = revenue.rows[0];
  const m = menuStats.rows[0];
  const rat = ratings.rows[0];

  ok(res, {
    cafe: cafe.rows[0],
    orders: {
      total: parseInt(o.total),
      pending: parseInt(o.pending),
      confirmed: parseInt(o.confirmed),
      preparing: parseInt(o.preparing),
      ready: parseInt(o.ready),
      served: parseInt(o.served),
      cancelled: parseInt(o.cancelled),
    },
    revenue: {
      total: parseFloat(r.total_revenue),
      paid: parseFloat(r.revenue_paid),
      pending: parseFloat(r.revenue_pending),
      completed_orders: parseInt(r.completed_orders),
    },
    menu: {
      available_items: parseInt(m.available_items),
      total_items: parseInt(m.total_items),
      total_categories: parseInt(m.total_categories),
    },
    ratings: {
      avg_rating: parseFloat(rat.avg_rating),
      total_ratings: parseInt(rat.total_ratings),
    },
  });
});

// ─── POST /api/admin/broadcast ────────────────────────────────
// Send announcement email to all active cafes
// Accepts: { subject, message, plan_filter: 'all'|'paid'|'trial' }
exports.broadcastEmail = asyncHandler(async (req, res) => {
  const { subject, message, plan_filter = 'all' } = req.body;

  if (!subject || !message) {
    return fail(res, 'subject and message are required');
  }

  // Wrap plain text message in minimal HTML for email clients
  const htmlBody = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#f97316;margin-bottom:16px">DineVerse Platform Notice</h2>
      <div style="color:#374151;white-space:pre-wrap;line-height:1.6">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
      <p style="color:#9ca3af;font-size:12px">DineVerse — Café Ordering Platform · You received this as a registered café owner.</p>
    </div>
  `;

  // Get list of cafes based on plan_filter
  let cafesResult;
  if (plan_filter === 'paid') {
    cafesResult = await db.query(
      `SELECT id, email FROM cafes WHERE is_active = true AND plan_type != 'free_trial' AND plan_expiry_date > NOW()`
    );
  } else if (plan_filter === 'trial') {
    cafesResult = await db.query(
      `SELECT id, email FROM cafes WHERE is_active = true AND plan_type = 'free_trial' AND plan_expiry_date > NOW()`
    );
  } else {
    cafesResult = await db.query(`SELECT id, email FROM cafes WHERE is_active = true`);
  }

  const cafes = cafesResult.rows;
  if (cafes.length === 0) {
    return fail(res, 'No cafes to broadcast to', 400);
  }

  // Send emails
  let successCount = 0;
  let failedEmails = [];

  for (const cafe of cafes) {
    try {
      await sendBroadcastEmail(cafe.email, subject, htmlBody);
      successCount++;
    } catch (err) {
      logger.error('Failed to send broadcast to café %s: %s', cafe.email, err.message);
      failedEmails.push(cafe.email);
    }
  }

  logger.info('Admin broadcast email sent to %d cafes (failed: %d)', successCount, failedEmails.length);
  ok(res, {
    sent: successCount,
    failed: failedEmails.length,
    failed_emails: failedEmails,
  }, `Broadcast sent to ${successCount} café(s)`);
});
