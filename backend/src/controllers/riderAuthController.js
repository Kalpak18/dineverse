/**
 * Rider authentication.
 *
 * Login is via EMAIL OTP (reusing the existing Brevo-backed email infra).
 * Phone OTP is implemented but commented out — uncomment + plug in your
 * SMS provider (Twilio / MSG91 / Fast2SMS) when ready.
 *
 * Flow:
 *   1. Rider must already exist in cafe_riders (created by their cafe owner)
 *   2. POST /api/rider/auth/send-otp { email }    → sends 6-digit code via Brevo
 *   3. POST /api/rider/auth/verify-otp { email, otp } → returns JWT
 *   4. JWT carries { riderId, cafeId, role: 'RIDER', tv } and expires in 7d
 */

const jwt = require('jsonwebtoken');
const db  = require('../config/database');
const { createOtp, verifyOtp, checkSendCooldown } = require('../utils/otpStore');
const { sendOtpEmail }  = require('../services/emailService');
const { ok, fail }      = require('../utils/respond');
const asyncHandler      = require('../utils/asyncHandler');
const logger            = require('../utils/logger');

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');

function generateRiderToken(rider) {
  return jwt.sign(
    { riderId: rider.id, cafeId: rider.cafe_id, role: 'RIDER', tv: rider.token_version || 1 },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ─── POST /api/rider/auth/send-otp ────────────────────────────
exports.sendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) return fail(res, 'Valid email is required');

  const lower = email.trim().toLowerCase();

  // Rider must be pre-registered by their cafe (owner adds via Profile → Riders)
  const r = await db.query(
    `SELECT cr.id, cr.cafe_id, cr.is_active, c.delivery_enabled
     FROM cafe_riders cr
     JOIN cafes c ON c.id = cr.cafe_id
     WHERE LOWER(cr.email) = $1 AND cr.is_active = true
     LIMIT 1`,
    [lower]
  );
  if (!r.rows.length) {
    // Don't leak which emails exist — generic message
    return fail(res, 'No active rider account found for this email. Ask your café to add you.', 404);
  }
  if (!r.rows[0].delivery_enabled) {
    return fail(res, 'Your café has not enabled delivery yet. Ask the owner to enable it from Profile → Delivery.', 403);
  }

  const cooldown = await checkSendCooldown(lower, 'rider_login');
  if (cooldown) {
    return res.status(429).json({
      success: false,
      message: `Please wait ${cooldown.retryAfter} seconds before requesting another code`,
      retryAfter: cooldown.retryAfter,
    });
  }

  const otp = await createOtp(lower, 'rider_login');

  if (!process.env.BREVO_API_KEY) {
    logger.warn('⚠  BREVO_API_KEY not set — rider OTP for %s: %s (dev only)', email, otp);
    return ok(res, { dev: true }, 'DEV: OTP printed to server console (BREVO_API_KEY not set)');
  }

  try {
    await sendOtpEmail(lower, otp);
    ok(res, {}, 'Verification code sent to your email');
  } catch (err) {
    logger.error('Rider OTP email failed for %s: %s', email, err.message);
    return fail(res, 'Could not send the email — please try again in a moment.', 502);
  }
});

// ─── POST /api/rider/auth/verify-otp ──────────────────────────
exports.verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !isValidEmail(email)) return fail(res, 'Valid email is required');
  if (!otp)                            return fail(res, 'Verification code is required');

  const lower = email.trim().toLowerCase();
  const check = await verifyOtp(lower, otp, 'rider_login');
  if (!check.valid) return fail(res, check.reason, 400);

  const r = await db.query(
    `SELECT cr.*, c.delivery_enabled, c.name AS cafe_name, c.slug AS cafe_slug
     FROM cafe_riders cr
     JOIN cafes c ON c.id = cr.cafe_id
     WHERE LOWER(cr.email) = $1 AND cr.is_active = true
     LIMIT 1`,
    [lower]
  );
  if (!r.rows.length) return fail(res, 'Rider account not found', 404);
  const rider = r.rows[0];
  if (!rider.delivery_enabled) {
    return fail(res, 'Your café has not enabled delivery yet.', 403);
  }

  await db.query('UPDATE cafe_riders SET last_seen_at = NOW() WHERE id = $1', [rider.id]);

  const token = generateRiderToken(rider);
  ok(res, {
    token,
    rider: {
      id:        rider.id,
      name:      rider.name,
      phone:     rider.phone,
      email:     rider.email,
      cafe_id:   rider.cafe_id,
      cafe_name: rider.cafe_name,
      cafe_slug: rider.cafe_slug,
    },
  }, 'Logged in');
});

// ─── GET /api/rider/auth/me ───────────────────────────────────
exports.getMe = asyncHandler(async (req, res) => {
  const r = await db.query(
    `SELECT cr.id, cr.name, cr.phone, cr.email, cr.cafe_id,
            c.name AS cafe_name, c.slug AS cafe_slug, c.delivery_enabled
     FROM cafe_riders cr
     JOIN cafes c ON c.id = cr.cafe_id
     WHERE cr.id = $1 AND cr.is_active = true`,
    [req.riderId]
  );
  if (!r.rows.length) return fail(res, 'Rider not found', 404);
  ok(res, { rider: r.rows[0] });
});

/* ─────────────────────────────────────────────────────────────
 * PHONE OTP — TODO: enable when SMS gateway is configured
 *
 * Requires:
 *   - SMS provider (Twilio / MSG91 / Fast2SMS) configured via env vars
 *   - A `sendSmsOtp(phone, otp)` helper in services/smsService.js
 *
 * exports.sendPhoneOtp = asyncHandler(async (req, res) => {
 *   const { phone } = req.body;
 *   if (!/^\+?\d{10,15}$/.test(phone || '')) return fail(res, 'Valid phone number required');
 *   const normalized = String(phone).replace(/\D/g, '').slice(-10);
 *
 *   const r = await db.query(
 *     `SELECT cr.id FROM cafe_riders cr
 *      JOIN cafes c ON c.id = cr.cafe_id
 *      WHERE cr.phone = $1 AND cr.is_active = true AND c.delivery_enabled = true`,
 *     [normalized]
 *   );
 *   if (!r.rows.length) return fail(res, 'No active rider for this phone', 404);
 *
 *   const cooldown = await checkSendCooldown(normalized, 'rider_phone_login');
 *   if (cooldown) return res.status(429).json({ success: false, retryAfter: cooldown.retryAfter });
 *
 *   const otp = await createOtp(normalized, 'rider_phone_login');
 *   await sendSmsOtp(normalized, otp);
 *   ok(res, {}, 'Verification code sent via SMS');
 * });
 *
 * exports.verifyPhoneOtp = asyncHandler(async (req, res) => {
 *   const { phone, otp } = req.body;
 *   const normalized = String(phone || '').replace(/\D/g, '').slice(-10);
 *   const check = await verifyOtp(normalized, otp, 'rider_phone_login');
 *   if (!check.valid) return fail(res, check.reason, 400);
 *   // ... look up rider by phone, issue token (same as email path) ...
 * });
 * ───────────────────────────────────────────────────────────── */
