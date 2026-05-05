const Razorpay = require('razorpay');
const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../utils/logger');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const cache = require('../utils/cache');

// ─── Pricing config ───────────────────────────────────────────
// Basic (Essential): ₹499/mo | Premium (Kitchen Pro): ₹999/mo
// Longer commitments: 10% off at 2yr, 11% off at 3yr.
const PLANS = {
  // ── Basic (Essential) tier ───────────────────────────────────
  'basic_1month':  { label: 'Essential · 1 Month',   price_paise:  49900, months:  1, tier: 'basic' },
  'basic_3month':  { label: 'Essential · 3 Months',  price_paise: 149700, months:  3, tier: 'basic' },
  'basic_6month':  { label: 'Essential · 6 Months',  price_paise: 299400, months:  6, tier: 'basic' },
  'basic_1year':   { label: 'Essential · 1 Year',    price_paise: 598800, months: 12, tier: 'basic' },
  'basic_2year':   { label: 'Essential · 2 Years',   price_paise:1077840, months: 24, tier: 'basic' },
  'basic_3year':   { label: 'Essential · 3 Years',   price_paise:1596132, months: 36, tier: 'basic' },
  // ── Premium (Kitchen Pro) tier ──────────────────────────────
  'premium_1month':  { label: 'Kitchen Pro · 1 Month',   price_paise:  99900, months:  1, tier: 'premium' },
  'premium_3month':  { label: 'Kitchen Pro · 3 Months',  price_paise: 299700, months:  3, tier: 'premium' },
  'premium_6month':  { label: 'Kitchen Pro · 6 Months',  price_paise: 599400, months:  6, tier: 'premium' },
  'premium_1year':   { label: 'Kitchen Pro · 1 Year',    price_paise:1198800, months: 12, tier: 'premium' },
  'premium_2year':   { label: 'Kitchen Pro · 2 Years',   price_paise:2157840, months: 24, tier: 'premium' },
  'premium_3year':   { label: 'Kitchen Pro · 3 Years',   price_paise:3192132, months: 36, tier: 'premium' },
  // ── Legacy keys — old payment records still resolve correctly
  '1year':  { label: '1 Year Plan',  price_paise:  598800, months: 12, tier: 'basic' },
  '2year':  { label: '2 Year Plan',  price_paise: 1077840, months: 24, tier: 'basic' },
  '3year':  { label: '3 Year Plan',  price_paise: 1596132, months: 36, tier: 'basic' },
  yearly:   { label: '1 Year Plan',  price_paise:  598800, months: 12, tier: 'basic' },
};

// Support both RAZORPAY_KEY_ID (production) and RAZORPAY_TEST_KEY_ID (legacy/dev)
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID     || process.env.RAZORPAY_TEST_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET,
});

// ─── GET /api/payments/plans ──────────────────────────────────
// Returns available plans + current subscription info
exports.getPlans = asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT plan_type, plan_tier, plan_start_date, plan_expiry_date FROM cafes WHERE id = $1',
    [req.cafeId]
  );
  const cafe = result.rows[0];
  const now = new Date();
  const expiry = cafe.plan_expiry_date ? new Date(cafe.plan_expiry_date) : null;
  const isActive = expiry && expiry > now;
  const daysLeft = expiry ? Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)) : 0;

  ok(res, {
    current: {
      plan_type: cafe.plan_type,
      plan_tier: cafe.plan_tier || null,
      plan_expiry_date: cafe.plan_expiry_date,
      is_active: isActive,
      days_left: isActive ? daysLeft : 0,
    },
    plans: Object.entries(PLANS).map(([key, p]) => ({
      key,
      label: p.label,
      price_paise: p.price_paise,
      price_rupees: p.price_paise / 100,
      months: p.months,
    })),
    razorpay_key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
  });
});

// ─── POST /api/payments/create-order ─────────────────────────
exports.createOrder = asyncHandler(async (req, res) => {
  const { plan_key = '1year' } = req.body;
  const plan = PLANS[plan_key];
  if (!plan) return fail(res, 'Invalid plan selected');

  // Fetch cafe for receipt
  const cafeRes = await db.query(
    'SELECT name, email FROM cafes WHERE id = $1',
    [req.cafeId]
  );
  const cafe = cafeRes.rows[0];

  // Cancel any stale pending orders for this café so they don't stack up
  await db.query(
    `UPDATE payments SET status = 'cancelled' WHERE cafe_id = $1 AND status = 'pending'`,
    [req.cafeId]
  );

  const rpOrder = await razorpay.orders.create({
    amount: plan.price_paise,
    currency: 'INR',
    receipt: `dv_${req.cafeId.slice(0, 8)}_${Date.now()}`,
    notes: {
      cafe_id: req.cafeId,
      cafe_name: cafe.name,
      plan: plan_key,
    },
  });

  // Persist new pending payment
  await db.query(
    `INSERT INTO payments (cafe_id, razorpay_order_id, amount_paise, plan_type, status)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [req.cafeId, rpOrder.id, plan.price_paise, plan_key]
  );

  logger.info('Razorpay order created: %s for cafe %s', rpOrder.id, req.cafeId);
  ok(res, {
    order_id: rpOrder.id,
    amount: plan.price_paise,
    currency: 'INR',
    cafe_name: cafe.name,
    cafe_email: cafe.email,
    plan_label: plan.label,
    razorpay_key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID,
  });
});

// ─── POST /api/payments/verify ────────────────────────────────
exports.verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return fail(res, 'Missing payment details');
  }

  const secret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET;
  if (!secret) return fail(res, 'Payment gateway not configured', 503);

  // Verify HMAC signature
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature) {
    logger.warn('Invalid Razorpay signature for order %s', razorpay_order_id);
    return fail(res, 'Payment verification failed — invalid signature', 400);
  }

  // Fetch the pending payment
  const paymentRes = await db.query(
    'SELECT * FROM payments WHERE razorpay_order_id = $1 AND cafe_id = $2',
    [razorpay_order_id, req.cafeId]
  );
  if (paymentRes.rows.length === 0) return fail(res, 'Payment record not found', 404);

  const payment = paymentRes.rows[0];
  if (payment.status === 'completed') {
    return fail(res, 'Payment already processed', 409);
  }

  // Verify the actual amount charged matches what we expect — prevents ₹1 plan activation
  const rzpPayment = await razorpay.payments.fetch(razorpay_payment_id);
  if (parseInt(rzpPayment.amount, 10) !== payment.amount_paise) {
    logger.warn('Amount mismatch for order %s: expected %d paise, got %d', razorpay_order_id, payment.amount_paise, rzpPayment.amount);
    return fail(res, 'Payment amount mismatch', 400);
  }

  const plan = PLANS[payment.plan_type];
  const months = plan ? plan.months : 12;
  const tier   = plan?.tier || 'basic';

  // Calculate new expiry: extend from current expiry if still active, else from today
  const cafeRes = await db.query(
    'SELECT plan_expiry_date FROM cafes WHERE id = $1',
    [req.cafeId]
  );
  const currentExpiry = cafeRes.rows[0]?.plan_expiry_date;
  const base = (currentExpiry && new Date(currentExpiry) > new Date())
    ? new Date(currentExpiry)
    : new Date();

  base.setMonth(base.getMonth() + months);

  // Update payment + cafe plan in one transaction
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE payments SET
         razorpay_payment_id = $1,
         razorpay_signature  = $2,
         status              = 'completed'
       WHERE razorpay_order_id = $3`,
      [razorpay_payment_id, razorpay_signature, razorpay_order_id]
    );
    await client.query(
      `UPDATE cafes SET
         plan_type        = $1,
         plan_tier        = $2,
         plan_start_date  = NOW(),
         plan_expiry_date = $3
       WHERE id = $4`,
      [payment.plan_type, tier, base.toISOString(), req.cafeId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.info('Payment verified & plan activated: %s → %s (%s), expires %s',
    req.cafeId, payment.plan_type, tier, base.toISOString());

  ok(res, {
    plan_type: payment.plan_type,
    plan_tier: tier,
    plan_expiry_date: base.toISOString(),
  }, 'Payment verified — subscription activated!');
});

// ─── POST /api/payments/webhook ──────────────────────────────
// Called by Razorpay servers — no auth middleware, raw body required.
// Verifies X-Razorpay-Signature and activates subscription on payment.captured.
exports.webhookHandler = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret    = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn('RAZORPAY_WEBHOOK_SECRET not set — webhook ignored');
    return res.status(200).json({ ok: true }); // 200 so Razorpay doesn't retry
  }

  // req.body is a Buffer here (express.raw registered before express.json in app.js)
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  if (!signature || expected !== signature) {
    logger.warn('Razorpay webhook: invalid signature');
    return res.status(400).json({ success: false, message: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
  }

  // Only act on successful payment capture
  if (event.event !== 'payment.captured') {
    return res.status(200).json({ ok: true, ignored: event.event });
  }

  const payment = event.payload?.payment?.entity;
  if (!payment) return res.status(200).json({ ok: true });

  const razorpay_order_id  = payment.order_id;
  const razorpay_payment_id = payment.id;

  if (!razorpay_order_id) {
    logger.warn('Webhook payment.captured missing order_id');
    return res.status(200).json({ ok: true });
  }

  // Look up the pending payment record
  const paymentRes = await db.query(
    'SELECT * FROM payments WHERE razorpay_order_id = $1',
    [razorpay_order_id]
  );

  if (paymentRes.rows.length === 0) {
    logger.warn('Webhook: no payment record for order %s', razorpay_order_id);
    return res.status(200).json({ ok: true }); // 200 so Razorpay doesn't keep retrying
  }

  const record = paymentRes.rows[0];

  if (record.status === 'completed') {
    // Already processed (e.g. via verifyPayment after checkout) — idempotent
    return res.status(200).json({ ok: true, already: true });
  }

  const plan   = PLANS[record.plan_type];
  const months = plan ? plan.months : 12;
  const tier   = plan?.tier || 'basic';

  // Extend from current expiry if still active, else from today
  const cafeRes = await db.query(
    'SELECT plan_expiry_date FROM cafes WHERE id = $1',
    [record.cafe_id]
  );
  const currentExpiry = cafeRes.rows[0]?.plan_expiry_date;
  const base = (currentExpiry && new Date(currentExpiry) > new Date())
    ? new Date(currentExpiry)
    : new Date();
  base.setMonth(base.getMonth() + months);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE payments SET
         razorpay_payment_id = $1,
         status              = 'completed'
       WHERE razorpay_order_id = $2`,
      [razorpay_payment_id, razorpay_order_id]
    );
    await client.query(
      `UPDATE cafes SET
         plan_type        = $1,
         plan_tier        = $2,
         plan_start_date  = NOW(),
         plan_expiry_date = $3
       WHERE id = $4`,
      [record.plan_type, tier, base.toISOString(), record.cafe_id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Webhook DB error for order %s: %s', razorpay_order_id, err.message);
    // Return 500 so Razorpay retries
    return res.status(500).json({ success: false, message: 'DB error' });
  } finally {
    client.release();
  }

  logger.info('Webhook activated subscription: cafe %s → %s, expires %s',
    record.cafe_id, record.plan_type, base.toISOString());

  res.status(200).json({ ok: true });
});

// ─── GET /api/payments/history ────────────────────────────────
exports.getHistory = asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT id, razorpay_order_id, razorpay_payment_id,
            amount_paise, plan_type, status, created_at
     FROM payments WHERE cafe_id = $1 ORDER BY created_at DESC`,
    [req.cafeId]
  );
  ok(res, { payments: result.rows });
});

// ─── GET /api/payments/route/status ───────────────────────────
exports.getRouteStatus = asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT razorpay_account_id, razorpay_account_status, razorpay_route_enabled
     FROM cafes WHERE id = $1`,
    [req.cafeId]
  );
  const cafe = result.rows[0];
  ok(res, {
    account_id:     cafe.razorpay_account_id || null,
    status:         cafe.razorpay_account_status || 'not_connected',
    route_enabled:  cafe.razorpay_route_enabled || false,
  });
});

// ─── POST /api/payments/route/connect ─────────────────────────
// Creates a Razorpay linked account with minimal info.
// Razorpay then emails the café owner a hosted onboarding link where
// they enter their own bank details, PAN, and complete KYC directly
// on Razorpay's platform — we never see or store any sensitive data.
exports.connectRoute = asyncHandler(async (req, res) => {
  const {
    legal_business_name,
    business_type = 'proprietorship',
    contact_name,
  } = req.body;

  if (!legal_business_name || !contact_name) {
    return fail(res, 'legal_business_name and contact_name are required', 400);
  }

  const cafeRes = await db.query(
    `SELECT id, name, email, phone, address, city, state, pincode,
            razorpay_account_id
     FROM cafes WHERE id = $1`,
    [req.cafeId]
  );
  const cafe = cafeRes.rows[0];
  if (!cafe) return fail(res, 'Café not found', 404);

  if (cafe.razorpay_account_id) {
    return fail(res, 'A payout account is already registered for this café', 409);
  }

  const keyId     = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET;
  if (!keyId || !keySecret) return fail(res, 'Payment gateway not configured', 503);

  const phone = (cafe.phone || '9999999999').replace(/\D/g, '').slice(-10);

  // Create linked account — Razorpay emails the owner a hosted KYC link
  // so they fill in bank details, PAN, etc. directly on Razorpay's platform.
  let account;
  try {
    account = await razorpay.accounts.create({
      email:               cafe.email,
      type:                'route',
      legal_business_name,
      business_type,
      contact_name,
      phone:               { primary: phone },
      profile: {
        category:    'food_and_beverage',
        subcategory: 'restaurant',
        addresses: {
          registered: {
            street1:     cafe.address || '1 Main Street',
            city:        cafe.city    || 'Mumbai',
            state:       cafe.state   || 'Maharashtra',
            postal_code: String(cafe.pincode || '400001'),
            country:     'IN',
          },
        },
      },
    });
  } catch (err) {
    logger.error('Razorpay account create failed for cafe %s: %s', req.cafeId, err.message);
    return fail(res, err.error?.description || 'Failed to create payout account', 502);
  }

  await db.query(
    `UPDATE cafes
     SET razorpay_account_id = $1, razorpay_account_status = 'pending', razorpay_route_enabled = false
     WHERE id = $2`,
    [account.id, req.cafeId]
  );

  logger.info('Razorpay Route account created: %s for cafe %s', account.id, req.cafeId);
  ok(res, {
    account_id: account.id,
    status:     'pending',
  }, 'Payout account registered! Check your email to complete KYC on Razorpay.');
});

// ─── POST /api/payments/route/enable ──────────────────────────
// Manually enable Route for a café (called after KYC is confirmed).
// In production this should be triggered by a Razorpay webhook.
exports.enableRoute = asyncHandler(async (req, res) => {
  const { account_id } = req.body;

  // Verify the account belongs to this café
  const result = await db.query(
    'SELECT razorpay_account_id FROM cafes WHERE id = $1',
    [req.cafeId]
  );
  if (!result.rows[0]?.razorpay_account_id) {
    return fail(res, 'No Razorpay account connected', 400);
  }
  if (account_id && result.rows[0].razorpay_account_id !== account_id) {
    return fail(res, 'Account ID mismatch', 400);
  }

  const updated = await db.query(
    `UPDATE cafes SET razorpay_account_status = 'active', razorpay_route_enabled = true
     WHERE id = $1 RETURNING slug`,
    [req.cafeId]
  );
  // Bust the public café cache so razorpay_route_enabled is immediately visible
  if (updated.rows[0]?.slug) await cache.del(`cafe:${updated.rows[0].slug}`);

  ok(res, { route_enabled: true }, 'Payout routing activated!');
});

// ─── GET /api/payments/commission ─────────────────────────────
// Returns the owner's net revenue view — GMV minus commission — broken down
// by payment method so the owner clearly sees what they actually receive.
//
// Online orders  → commission auto-deducted via Razorpay transfer at payment time.
//                  Owner's net was already deposited to their bank account.
// Cash/UPI/Card  → owner collected the full amount; commission is "cash_due"
//                  and must be remitted to DineVerse.
exports.getCommissionSummary = asyncHandler(async (req, res) => {
  const cafeId = req.rootCafeId || req.cafeId;

  const [cafeRes, summaryRes, monthlyRes, recentRes] = await Promise.all([
    // Café commission rate
    db.query('SELECT commission_rate FROM cafes WHERE id = $1', [cafeId]),

    // All-time + this-month totals split by online vs cash
    db.query(
      `SELECT
        -- Totals (all time)
        COALESCE(SUM(final_amount), 0)                                              AS total_gmv,
        COALESCE(SUM(commission_amount), 0)                                         AS total_commission,
        COALESCE(SUM(final_amount - commission_amount), 0)                          AS total_net_revenue,
        COUNT(*)                                                                    AS total_paid_orders,

        -- This month
        COALESCE(SUM(final_amount)       FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())), 0) AS month_gmv,
        COALESCE(SUM(commission_amount)  FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())), 0) AS month_commission,
        COALESCE(SUM(final_amount - commission_amount) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())), 0) AS month_net_revenue,
        COUNT(*)               FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()))               AS month_paid_orders,

        -- Online (auto-deducted) — money already in café's bank account
        COALESCE(SUM(final_amount - commission_amount) FILTER (WHERE commission_status = 'auto_deducted'), 0) AS online_net_received,
        COALESCE(SUM(commission_amount)                FILTER (WHERE commission_status = 'auto_deducted'), 0) AS online_commission_auto,

        -- Cash/UPI/Card — café holds full amount, commission is owed to DineVerse
        COALESCE(SUM(final_amount)       FILTER (WHERE commission_status = 'cash_due'), 0) AS cash_gmv_held,
        COALESCE(SUM(commission_amount)  FILTER (WHERE commission_status = 'cash_due'), 0) AS cash_commission_owed,
        COALESCE(SUM(final_amount - commission_amount) FILTER (WHERE commission_status = 'cash_due'), 0) AS cash_net_yours

       FROM orders
       WHERE cafe_id = $1 AND status = 'paid'`,
      [cafeId]
    ),

    // Monthly breakdown
    db.query(
      `SELECT DATE_TRUNC('month', created_at)                                  AS month,
              COUNT(*)                                                           AS paid_orders,
              COALESCE(SUM(final_amount), 0)                                    AS gmv,
              COALESCE(SUM(commission_amount), 0)                               AS commission,
              COALESCE(SUM(final_amount - commission_amount), 0)                AS net_revenue,
              COALESCE(SUM(commission_amount) FILTER (WHERE commission_status = 'cash_due'), 0) AS cash_commission_owed,
              COALESCE(SUM(commission_amount) FILTER (WHERE commission_status = 'auto_deducted'), 0) AS online_commission_deducted
       FROM orders
       WHERE cafe_id = $1 AND status = 'paid'
       GROUP BY DATE_TRUNC('month', created_at)
       ORDER BY month DESC LIMIT 12`,
      [cafeId]
    ),

    // Recent 20 paid orders
    db.query(
      `SELECT id, daily_order_number, order_type, payment_mode,
              final_amount, commission_amount,
              (final_amount - commission_amount) AS net_amount,
              commission_status, created_at
       FROM orders
       WHERE cafe_id = $1 AND status = 'paid'
       ORDER BY created_at DESC LIMIT 20`,
      [cafeId]
    ),
  ]);

  const rate = parseFloat(cafeRes.rows[0]?.commission_rate ?? 5);
  const s    = summaryRes.rows[0];

  ok(res, {
    commission_rate: rate,

    // ── All-time ──
    total_gmv:          parseFloat(s.total_gmv),
    total_commission:   parseFloat(s.total_commission),
    total_net_revenue:  parseFloat(s.total_net_revenue),
    total_paid_orders:  parseInt(s.total_paid_orders),

    // ── This month ──
    month_gmv:          parseFloat(s.month_gmv),
    month_commission:   parseFloat(s.month_commission),
    month_net_revenue:  parseFloat(s.month_net_revenue),
    month_paid_orders:  parseInt(s.month_paid_orders),

    // ── Online (already in your bank) ──
    online_net_received:      parseFloat(s.online_net_received),
    online_commission_auto:   parseFloat(s.online_commission_auto),

    // ── Cash/UPI/Card (you hold full amount, commission owed to DineVerse) ──
    cash_gmv_held:         parseFloat(s.cash_gmv_held),
    cash_commission_owed:  parseFloat(s.cash_commission_owed),
    cash_net_yours:        parseFloat(s.cash_net_yours),

    // ── Monthly + recent ──
    monthly_breakdown: monthlyRes.rows.map((r) => ({
      month:                        r.month,
      paid_orders:                  parseInt(r.paid_orders),
      gmv:                          parseFloat(r.gmv),
      commission:                   parseFloat(r.commission),
      net_revenue:                  parseFloat(r.net_revenue),
      cash_commission_owed:         parseFloat(r.cash_commission_owed),
      online_commission_deducted:   parseFloat(r.online_commission_deducted),
    })),
    recent_orders: recentRes.rows.map((o) => ({
      ...o,
      final_amount:      parseFloat(o.final_amount),
      commission_amount: parseFloat(o.commission_amount),
      net_amount:        parseFloat(o.net_amount),
    })),
  });
});
