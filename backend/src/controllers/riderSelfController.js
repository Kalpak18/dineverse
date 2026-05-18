/**
 * Rider self-registration, profile management, nearby-orders discovery,
 * earnings ledger, and delivery history.
 *
 * Self-registered riders are NOT tied to a single café. They see ALL pending
 * delivery orders from cafés within their chosen service radius (≤ 10 km).
 * When a self-registered rider accepts a job the order is assigned to them
 * and they appear in that café's active delivery panel.
 *
 * Endpoints (all public unless noted):
 *   POST   /api/rider/register              — self-signup (email + OTP still used)
 *   GET    /api/rider/profile               — [auth] get own profile
 *   PATCH  /api/rider/profile               — [auth] update name/phone/vehicle/bio/photo
 *   PATCH  /api/rider/profile/location      — [auth] update base location + radius
 *   PATCH  /api/rider/availability          — [auth] toggle online/offline
 *   GET    /api/rider/nearby-orders         — [auth] pending orders within radius
 *   POST   /api/rider/nearby-orders/:id/accept — [auth] claim an unassigned order
 *   GET    /api/rider/earnings              — [auth] today + weekly + monthly + ledger
 *   GET    /api/rider/history               — [auth] completed/failed deliveries
 */

const db           = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const logger       = require('../utils/logger');
const { createOtp, verifyOtp, checkSendCooldown } = require('../utils/otpStore');
const { sendOtpEmail, sendRiderWelcomeEmail } = require('../services/emailService');

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const isValidPhone = (p) => /^[6-9]\d{9}$/.test((p || '').replace(/\D/g, ''));

// Haversine distance in km
function haversineKm(lat1, lng1, lat2, lng2) {
  const R  = 6371;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dO = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dO / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── POST /api/rider/register/send-otp ───────────────────────
exports.registerSendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) return fail(res, 'Valid email is required');

  const lower = email.trim().toLowerCase();

  // Block if already active rider with this email
  const existing = await db.query(
    `SELECT id, is_active, registration_status FROM cafe_riders WHERE LOWER(email) = $1 LIMIT 1`,
    [lower]
  );
  if (existing.rows.length && existing.rows[0].is_active) {
    return fail(res, 'An account with this email already exists. Please log in.', 409);
  }

  const cooldown = await checkSendCooldown(lower, 'rider_register');
  if (cooldown) {
    return res.status(429).json({
      success: false,
      message: `Please wait ${cooldown.retryAfter} seconds before requesting another code`,
      retryAfter: cooldown.retryAfter,
    });
  }

  const otp = await createOtp(lower, 'rider_register');

  if (!process.env.RESEND_API_KEY) {
    logger.warn('⚠  RESEND_API_KEY not set — rider register OTP for %s: %s (dev only)', email, otp);
    return ok(res, { dev: true }, 'DEV: OTP printed to server console');
  }

  try {
    await sendOtpEmail(lower, otp);
    ok(res, {}, 'Verification code sent to your email');
  } catch (err) {
    logger.error('Rider register OTP email failed: %s', err.message);
    return fail(res, 'Could not send the email — please try again.', 502);
  }
});

// ─── POST /api/rider/register/verify ─────────────────────────
exports.registerVerify = asyncHandler(async (req, res) => {
  const { email, otp, name, phone, vehicle_type, base_lat, base_lng, base_address, service_radius_km } = req.body;

  if (!email || !isValidEmail(email)) return fail(res, 'Valid email is required');
  if (!otp || !/^\d{6}$/.test(otp))   return fail(res, '6-digit code required');
  if (!name || !name.trim())           return fail(res, 'Name is required');
  if (phone && !isValidPhone(phone))   return fail(res, 'Enter a valid 10-digit Indian mobile number');

  const lower = email.trim().toLowerCase();
  const check = await verifyOtp(lower, otp, 'rider_register');
  if (!check.valid) return fail(res, check.reason, 400);

  // Idempotent — if rider already exists (e.g. re-registered), reactivate
  const existing = await db.query(
    `SELECT id FROM cafe_riders WHERE LOWER(email) = $1 LIMIT 1`, [lower]
  );

  let rider;
  if (existing.rows.length) {
    const r = await db.query(
      `UPDATE cafe_riders SET
         name = $1, phone = $2, vehicle_type = $3,
         base_lat = $4, base_lng = $5, base_address = $6,
         service_radius_km = $7,
         is_active = TRUE, is_self_registered = TRUE,
         registration_status = 'active', last_seen_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        name.trim(), phone?.trim() || null,
        vehicle_type || 'bike',
        base_lat ? parseFloat(base_lat) : null,
        base_lng ? parseFloat(base_lng) : null,
        base_address || null,
        Math.min(parseFloat(service_radius_km) || 10, 10),
        existing.rows[0].id,
      ]
    );
    rider = r.rows[0];
  } else {
    const r = await db.query(
      `INSERT INTO cafe_riders
         (cafe_id, name, phone, email, vehicle_type,
          base_lat, base_lng, base_address, service_radius_km,
          is_active, is_self_registered, registration_status, last_seen_at)
       VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, TRUE, TRUE, 'active', NOW())
       RETURNING *`,
      [
        name.trim(), phone?.trim() || null, lower,
        vehicle_type || 'bike',
        base_lat ? parseFloat(base_lat) : null,
        base_lng ? parseFloat(base_lng) : null,
        base_address || null,
        Math.min(parseFloat(service_radius_km) || 10, 10),
      ]
    );
    rider = r.rows[0];
  }

  // Send welcome email (non-blocking)
  if (process.env.RESEND_API_KEY) {
    sendRiderWelcomeEmail(lower, name.trim()).catch(() => {});
  }

  // Issue JWT using the same helper from riderAuthController
  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { riderId: rider.id, cafeId: rider.cafe_id || null, role: 'RIDER', tv: rider.token_version || 1 },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  logger.info('New self-registered rider: %s (%s)', name, lower);
  ok(res, {
    token,
    rider: {
      id:           rider.id,
      name:         rider.name,
      phone:        rider.phone,
      email:        rider.email,
      cafe_id:      rider.cafe_id,
      cafe_name:    null,
      is_self_registered: true,
      vehicle_type: rider.vehicle_type,
      base_lat:     rider.base_lat,
      base_lng:     rider.base_lng,
      base_address: rider.base_address,
      service_radius_km: rider.service_radius_km,
    },
  }, 'Registration successful! Welcome to DineVerse Rider.');
});

// ─── GET /api/rider/profile ───────────────────────────────────
exports.getProfile = asyncHandler(async (req, res) => {
  const r = await db.query(
    `SELECT cr.id, cr.name, cr.phone, cr.email, cr.cafe_id,
            cr.is_self_registered, cr.registration_status,
            cr.base_lat, cr.base_lng, cr.base_address, cr.service_radius_km,
            cr.is_online, cr.vehicle_type, cr.vehicle_number,
            cr.total_deliveries, cr.total_earnings,
            cr.today_deliveries, cr.today_earnings, cr.earnings_date,
            cr.profile_photo_url, cr.bio, cr.last_seen_at,
            c.name AS cafe_name, c.slug AS cafe_slug
     FROM cafe_riders cr
     LEFT JOIN cafes c ON c.id = cr.cafe_id
     WHERE cr.id = $1 AND cr.is_active = TRUE`,
    [req.riderId]
  );
  if (!r.rows.length) return fail(res, 'Rider not found', 404);

  // Reset today_* if earnings_date is not today
  const rider = r.rows[0];
  const today = new Date().toISOString().slice(0, 10);
  if (rider.earnings_date && rider.earnings_date.toISOString?.().slice(0, 10) !== today) {
    rider.today_deliveries = 0;
    rider.today_earnings   = 0;
  }

  ok(res, { rider });
});

// ─── PATCH /api/rider/profile ─────────────────────────────────
exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, phone, vehicle_type, vehicle_number, bio, profile_photo_url } = req.body;

  if (phone && !isValidPhone(phone)) return fail(res, 'Enter a valid 10-digit Indian mobile number');

  const ALLOWED_VEHICLES = ['bike', 'scooter', 'bicycle', 'car', 'van'];
  if (vehicle_type && !ALLOWED_VEHICLES.includes(vehicle_type)) {
    return fail(res, 'Invalid vehicle type');
  }

  const r = await db.query(
    `UPDATE cafe_riders SET
       name              = COALESCE(NULLIF($1,''), name),
       phone             = COALESCE($2, phone),
       vehicle_type      = COALESCE($3, vehicle_type),
       vehicle_number    = COALESCE($4, vehicle_number),
       bio               = COALESCE($5, bio),
       profile_photo_url = COALESCE($6, profile_photo_url),
       last_seen_at      = NOW()
     WHERE id = $7
     RETURNING id, name, phone, vehicle_type, vehicle_number, bio, profile_photo_url`,
    [name?.trim() || '', phone?.trim() || null, vehicle_type || null,
     vehicle_number?.trim() || null, bio?.trim() || null,
     profile_photo_url || null, req.riderId]
  );
  ok(res, { rider: r.rows[0] });
});

// ─── PATCH /api/rider/profile/location ───────────────────────
exports.updateBaseLocation = asyncHandler(async (req, res) => {
  const { base_lat, base_lng, base_address, service_radius_km } = req.body;
  const lat = parseFloat(base_lat);
  const lng = parseFloat(base_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 'Valid lat/lng required');

  // Cap radius at 10 km per platform policy
  const radius = Math.min(parseFloat(service_radius_km) || 10, 10);

  await db.query(
    `UPDATE cafe_riders SET
       base_lat = $1, base_lng = $2, base_address = $3, service_radius_km = $4
     WHERE id = $5`,
    [lat, lng, base_address?.trim() || null, radius, req.riderId]
  );
  ok(res, { base_lat: lat, base_lng: lng, base_address, service_radius_km: radius });
});

// ─── PATCH /api/rider/availability ───────────────────────────
exports.toggleAvailability = asyncHandler(async (req, res) => {
  const { is_online } = req.body;
  if (typeof is_online !== 'boolean') return fail(res, 'is_online (boolean) required');

  const r = await db.query(
    `UPDATE cafe_riders SET is_online = $1, last_seen_at = NOW()
     WHERE id = $2 RETURNING is_online`,
    [is_online, req.riderId]
  );
  ok(res, { is_online: r.rows[0].is_online });
});

// ─── GET /api/rider/nearby-orders ────────────────────────────
// Returns pending (unassigned) delivery orders from cafés within the rider's radius.
// Only the rider's own radius (max 10 km) is applied.
exports.getNearbyOrders = asyncHandler(async (req, res) => {
  const rider = await db.query(
    `SELECT base_lat, base_lng, service_radius_km FROM cafe_riders WHERE id = $1`,
    [req.riderId]
  );
  if (!rider.rows.length) return fail(res, 'Rider not found', 404);

  const { base_lat, base_lng, service_radius_km } = rider.rows[0];
  if (!base_lat || !base_lng) {
    return fail(res, 'Set your base location first to see nearby orders.', 422);
  }

  const radius = Math.min(parseFloat(service_radius_km) || 10, 10);

  // Haversine bounding box pre-filter then exact calc in WHERE
  const latDelta = radius / 111.0;
  const lngDelta = radius / (111.0 * Math.cos((parseFloat(base_lat) * Math.PI) / 180));

  const result = await db.query(
    `SELECT
       o.id,
       COALESCE(o.daily_order_number, o.order_number) AS order_number,
       o.customer_name, o.delivery_address, o.delivery_city,
       o.delivery_lat, o.delivery_lng, o.delivery_fee,
       o.final_amount, o.payment_mode, o.created_at,
       o.delivery_instructions,
       c.id         AS cafe_id,
       c.name       AS cafe_name,
       c.address    AS cafe_address,
       c.latitude   AS cafe_lat,
       c.longitude  AS cafe_lng,
       -- distance from rider base to cafe (pickup distance)
       ROUND(
         6371 * 2 * ASIN(SQRT(
           POWER(SIN((RADIANS($1) - RADIANS(c.latitude::FLOAT)) / 2), 2) +
           COS(RADIANS($1)) * COS(RADIANS(c.latitude::FLOAT)) *
           POWER(SIN((RADIANS($2) - RADIANS(c.longitude::FLOAT)) / 2), 2)
         ))::NUMERIC, 2
       ) AS distance_km,
       (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
     FROM orders o
     JOIN cafes c ON c.id = o.cafe_id
     WHERE o.order_type    = 'delivery'
       AND o.delivery_status = 'pending'
       AND o.rider_id IS NULL
       AND o.status    NOT IN ('cancelled', 'paid')
       AND c.delivery_enabled = TRUE
       AND c.latitude  IS NOT NULL
       AND c.latitude::FLOAT  BETWEEN $3 AND $4
       AND c.longitude::FLOAT BETWEEN $5 AND $6
       AND 6371 * 2 * ASIN(SQRT(
             POWER(SIN((RADIANS($1) - RADIANS(c.latitude::FLOAT)) / 2), 2) +
             COS(RADIANS($1)) * COS(RADIANS(c.latitude::FLOAT)) *
             POWER(SIN((RADIANS($2) - RADIANS(c.longitude::FLOAT)) / 2), 2)
           )) <= $7
     ORDER BY distance_km ASC, o.created_at ASC
     LIMIT 50`,
    [
      parseFloat(base_lat), parseFloat(base_lng),
      parseFloat(base_lat) - latDelta, parseFloat(base_lat) + latDelta,
      parseFloat(base_lng) - lngDelta, parseFloat(base_lng) + lngDelta,
      radius,
    ]
  );

  ok(res, { orders: result.rows, radius_km: radius });
});

// ─── POST /api/rider/nearby-orders/:id/accept ────────────────
exports.acceptNearbyOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Fetch rider info
  const riderRes = await db.query(
    `SELECT id, name, phone, base_lat, base_lng, service_radius_km, cafe_id
     FROM cafe_riders WHERE id = $1 AND is_active = TRUE`,
    [req.riderId]
  );
  if (!riderRes.rows.length) return fail(res, 'Rider not found', 404);
  const rider = riderRes.rows[0];

  // Fetch order and validate it's still claimable
  const orderRes = await db.query(
    `SELECT o.id, o.cafe_id, o.delivery_status, o.rider_id, o.delivery_lat, o.delivery_lng,
            c.latitude AS cafe_lat, c.longitude AS cafe_lng,
            c.delivery_enabled
     FROM orders o
     JOIN cafes c ON c.id = o.cafe_id
     WHERE o.id = $1 AND o.order_type = 'delivery'`,
    [id]
  );
  if (!orderRes.rows.length)          return fail(res, 'Order not found', 404);
  const order = orderRes.rows[0];
  if (!order.delivery_enabled)        return fail(res, 'Café delivery is not enabled', 403);
  if (order.rider_id)                 return fail(res, 'Order already claimed by another rider', 409);
  if (order.delivery_status !== 'pending') return fail(res, 'Order is no longer available', 409);

  // Validate rider is within radius of café
  if (rider.base_lat && rider.base_lng && order.cafe_lat && order.cafe_lng) {
    const dist = haversineKm(
      parseFloat(rider.base_lat), parseFloat(rider.base_lng),
      parseFloat(order.cafe_lat), parseFloat(order.cafe_lng)
    );
    const radius = Math.min(parseFloat(rider.service_radius_km) || 10, 10);
    if (dist > radius) {
      return fail(res, `This order is ${dist.toFixed(1)} km away — outside your ${radius} km radius.`, 403);
    }
  }

  // Atomically claim the order (optimistic lock on rider_id IS NULL)
  const claim = await db.query(
    `UPDATE orders SET
       rider_id        = $1,
       driver_name     = $2,
       driver_phone    = $3,
       delivery_status = 'assigned',
       delivery_partner = 'self',
       updated_at      = NOW()
     WHERE id = $4 AND rider_id IS NULL AND delivery_status = 'pending'
     RETURNING id, cafe_id`,
    [rider.id, rider.name, rider.phone || '', id]
  );
  if (!claim.rows.length) return fail(res, 'Order was just claimed by another rider. Try another.', 409);

  // For self-registered riders: temporarily bind them to this café (for the job)
  // (cafe_id on rider stays NULL; we rely on the order's cafe_id for job fetching)

  // Notify café via socket
  req.io?.to(`cafe:${order.cafe_id}`).emit('order_updated', {
    id, delivery_status: 'assigned', driver_name: rider.name, driver_phone: rider.phone,
  });
  req.io?.to(`order:${id}`).emit('delivery_updated', {
    order_id: id, delivery_status: 'assigned', driver_name: rider.name,
  });

  logger.info('Rider %s (%s) accepted order %s from cafe %s', rider.id, rider.name, id, order.cafe_id);
  ok(res, { order_id: id, delivery_status: 'assigned', cafe_id: order.cafe_id });
});

// ─── GET /api/rider/earnings ──────────────────────────────────
exports.getEarnings = asyncHandler(async (req, res) => {
  const { period = 'week' } = req.query;

  const periods = { today: 1, week: 7, month: 30 };
  const days    = periods[period] || 7;

  const [summary, ledger] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*)                                FILTER (WHERE earned_at >= NOW() - INTERVAL '1 day')  AS today_count,
         COALESCE(SUM(total_earned) FILTER (WHERE earned_at >= NOW() - INTERVAL '1 day'), 0)           AS today_earnings,
         COUNT(*)                                FILTER (WHERE earned_at >= NOW() - INTERVAL '7 days') AS week_count,
         COALESCE(SUM(total_earned) FILTER (WHERE earned_at >= NOW() - INTERVAL '7 days'), 0)          AS week_earnings,
         COUNT(*)                                FILTER (WHERE earned_at >= NOW() - INTERVAL '30 days') AS month_count,
         COALESCE(SUM(total_earned) FILTER (WHERE earned_at >= NOW() - INTERVAL '30 days'), 0)          AS month_earnings,
         COUNT(*)                                                                                        AS total_count,
         COALESCE(SUM(total_earned), 0)                                                                 AS total_earnings
       FROM rider_earnings
       WHERE rider_id = $1 AND status != 'cancelled'`,
      [req.riderId]
    ),
    db.query(
      `SELECT re.id, re.order_id, re.cafe_name, re.delivery_fee, re.tip_amount,
              re.total_earned, re.distance_km, re.status, re.earned_at,
              o.customer_name, o.delivery_address, o.delivery_city,
              COALESCE(o.daily_order_number, o.order_number) AS order_number
       FROM rider_earnings re
       LEFT JOIN orders o ON o.id = re.order_id
       WHERE re.rider_id = $1
         AND re.earned_at >= NOW() - ($2 || ' days')::INTERVAL
       ORDER BY re.earned_at DESC
       LIMIT 100`,
      [req.riderId, days]
    ),
  ]);

  ok(res, { summary: summary.rows[0], ledger: ledger.rows, period });
});

// ─── GET /api/rider/history ───────────────────────────────────
exports.getHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const result = await db.query(
    `SELECT
       o.id,
       COALESCE(o.daily_order_number, o.order_number) AS order_number,
       o.customer_name, o.delivery_address, o.delivery_city,
       o.delivery_status, o.final_amount, o.delivery_fee,
       o.delivery_failed_reason, o.created_at, o.delivered_at,
       c.name AS cafe_name,
       re.total_earned, re.distance_km
     FROM orders o
     JOIN cafes c ON c.id = o.cafe_id
     LEFT JOIN rider_earnings re ON re.order_id = o.id AND re.rider_id = $1
     WHERE o.rider_id = $1
       AND o.order_type = 'delivery'
       AND o.delivery_status IN ('delivered', 'failed')
     ORDER BY o.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.riderId, parseInt(limit), offset]
  );

  const count = await db.query(
    `SELECT COUNT(*) FROM orders
     WHERE rider_id = $1 AND order_type = 'delivery'
       AND delivery_status IN ('delivered', 'failed')`,
    [req.riderId]
  );

  ok(res, {
    deliveries: result.rows,
    total:      parseInt(count.rows[0].count),
    page:       parseInt(page),
    limit:      parseInt(limit),
  });
});
