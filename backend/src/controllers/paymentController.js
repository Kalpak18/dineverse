const Razorpay = require('razorpay');
const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../utils/logger');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// ─── Pricing config ───────────────────────────────────────────
// Base rate: ₹499/month. Longer commitments get a discount.
const PLANS = {
  '1year': { label: '1 Year Plan',  price_paise:  598800, months: 12 }, // ₹499 × 12 = ₹5,988
  '2year': { label: '2 Year Plan',  price_paise: 1078800, months: 24 }, // ₹449 × 24 = ₹10,788 (10% off)
  '3year': { label: '3 Year Plan',  price_paise: 1599900, months: 36 }, // ₹444 × 36 = ₹15,999 (11% off)
  // Legacy key — kept so old payment records still resolve correctly
  yearly:  { label: '1 Year Plan',  price_paise:  598800, months: 12 },
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
    'SELECT plan_type, plan_start_date, plan_expiry_date FROM cafes WHERE id = $1',
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

  // Persist pending payment
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

  const plan = PLANS[payment.plan_type];
  const months = plan ? plan.months : 12;

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
         plan_type         = $1,
         plan_start_date   = NOW(),
         plan_expiry_date  = $2
       WHERE id = $3`,
      [payment.plan_type, base.toISOString(), req.cafeId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.info('Payment verified & plan activated: %s → %s, expires %s',
    req.cafeId, payment.plan_type, base.toISOString());

  ok(res, {
    plan_type: payment.plan_type,
    plan_expiry_date: base.toISOString(),
  }, 'Payment verified — subscription activated!');
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
