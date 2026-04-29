const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { createOtp, verifyOtp, checkSendCooldown } = require('../utils/otpStore');
const { sendOtpEmail, sendPasswordResetEmail } = require('../services/emailService');
const { geocodeAddress } = require('../services/geocodingService');
const logger = require('../utils/logger');
const { ok, fail, validationFail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const cache = require('../utils/cache');

// role: 'OWNER' | 'STAFF'
// staffRole: 'cashier' | 'kitchen' | 'manager' (only when role === 'STAFF')
// rootCafeId: the brand account's ID — outlets inherit the parent's subscription
const generateToken = (cafeId, slug, role = 'OWNER', staffId = null, rootCafeId = null, staffRole = null, tokenVersion = 1) => {
  const payload = { cafeId, slug, role, rootCafeId: rootCafeId || cafeId, tv: tokenVersion };
  if (staffId) payload.staffId = staffId;
  if (staffRole) payload.staffRole = staffRole;
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const generateSetupSlug = () => `setup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

function verifyEmailOwnership(email, emailVerifiedToken) {
  try {
    const decoded = jwt.verify(emailVerifiedToken, process.env.JWT_SECRET);
    if (decoded.purpose !== 'email_verified' || decoded.email !== email) {
      return { valid: false, reason: 'Email verification token is invalid or does not match', code: 'TOKEN_MISMATCH' };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Email verification token is expired or invalid — please verify your email again', code: 'TOKEN_EXPIRED' };
  }
}

function validateGstin(gstin) {
  const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  const VALID_STATE_CODES = new Set([
    '01','02','03','04','05','06','07','08','09','10','11','12','13','14','15',
    '16','17','18','19','20','21','22','23','24','25','26','27','28','29','30',
    '31','32','33','34','35','36','37','38',
  ]);
  if (!gstin) return { valid: false, reason: 'GSTIN is empty' };
  const g = gstin.toUpperCase().trim();
  if (!GSTIN_REGEX.test(g)) return { valid: false, reason: 'GSTIN format is invalid' };
  const stateCode = g.slice(0, 2);
  if (!VALID_STATE_CODES.has(stateCode)) return { valid: false, reason: `Unknown state code: ${stateCode}` };
  return { valid: true };
}

// ─── Send OTP (registration — email via Brevo HTTP API) ──────
exports.sendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) return fail(res, 'Valid email is required');

  // Block sending OTP only to fully set-up accounts (setup_completed = true)
  // Accounts with setup_completed = false are still in progress — allow re-sending
  const active = await db.query(
    'SELECT id FROM cafes WHERE email = $1 AND is_active = true AND setup_completed = true',
    [email.trim().toLowerCase()]
  );
  if (active.rows.length > 0) {
    return fail(res, 'An account with this email already exists. Try logging in instead.', 409, 'EMAIL_TAKEN');
  }

  // Enforce 60s minimum gap between sends to the same email
  const cooldown = await checkSendCooldown(email.trim().toLowerCase(), 'register');
  if (cooldown) {
    return res.status(429).json({
      success: false,
      message: `Please wait ${cooldown.retryAfter} seconds before requesting another code`,
      error:   `Please wait ${cooldown.retryAfter} seconds before requesting another code`,
      errorCode: 'OTP_COOLDOWN',
      retryAfter: cooldown.retryAfter,
    });
  }

  const otp = await createOtp(email, 'register');

  // Dev fallback: if BREVO_API_KEY is not configured, log OTP to server console
  if (!process.env.BREVO_API_KEY) {
    logger.warn('⚠  BREVO_API_KEY not set — OTP for %s: %s (dev only)', email, otp);
    return ok(res, { dev: true }, 'DEV: OTP printed to server console (BREVO_API_KEY not set)');
  }

  try {
    await sendOtpEmail(email, otp);
    ok(res, {}, 'Verification code sent to your email');
  } catch (error) {
    logger.error('OTP email error for %s: %s', email, error.message);
    return fail(res, 'Failed to send verification email — please check your email address and try again.');
  }
});

// ─── Pre-verify email — confirms OTP eagerly and returns a 24h token ──
// Called when user clicks "Continue to Business Details".
// Frontend stores the token in localStorage and sends it at register time.
exports.preVerifyEmail = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !isValidEmail(email)) return fail(res, 'Valid email is required');
  if (!otp)                           return fail(res, 'Verification code is required');

  const otpCheck = await verifyOtp(email.trim().toLowerCase(), otp, 'register');
  if (!otpCheck.valid) {
    const codeMap = {
      'No OTP sent to this email':                              'OTP_NOT_SENT',
      'OTP expired — please request a new one':                 'OTP_EXPIRED',
      'Incorrect verification code':                            'OTP_WRONG',
      'Too many incorrect attempts — please request a new code':'OTP_MAX_ATTEMPTS',
    };
    return fail(res, otpCheck.reason, 400, codeMap[otpCheck.reason] || 'OTP_INVALID');
  }

  // Issue a short-lived signed token — proves email ownership without another OTP round-trip
  const emailVerifiedToken = jwt.sign(
    { email: email.trim().toLowerCase(), purpose: 'email_verified' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  ok(res, { emailVerifiedToken }, 'Email verified');
});

exports.validateCreateAccount = [
  body('email').isEmail().withMessage('Valid email is required').customSanitizer(v => v.trim().toLowerCase()),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('emailVerifiedToken').trim().notEmpty().withMessage('Email verification token is required'),
];

exports.createAccount = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { email, password, emailVerifiedToken } = req.body;
  const verified = verifyEmailOwnership(email, emailVerifiedToken);
  if (!verified.valid) return fail(res, verified.reason, 400, verified.code);

  const existing = await db.query(
    'SELECT id FROM cafes WHERE email = $1 AND is_active = true',
    [email]
  );
  if (existing.rows.length > 0) {
    return fail(res, 'An account with this email already exists. Try logging in instead.', 409, 'EMAIL_TAKEN');
  }

  const password_hash = await bcrypt.hash(password, 12);
  const placeholderSlug = generateSetupSlug();
  const result = await db.query(
    `INSERT INTO cafes (
       name, slug, email, password_hash,
       plan_type, plan_start_date, plan_expiry_date, setup_completed
     )
     VALUES ($1, $2, $3, $4, 'free_trial', NOW(), NOW() + INTERVAL '1 month', false)
     RETURNING id, name, slug, email, description,
               address, address_line2, city, state, pincode, phone,
               gst_number, gst_rate, fssai_number, upi_id, bill_prefix, bill_footer,
               pan_number, tax_inclusive, gst_verified, business_type, country,
               COALESCE(currency, 'INR') AS currency,
               plan_type, plan_start_date, plan_expiry_date, created_at, setup_completed`,
    ['My Cafe', placeholderSlug, email, password_hash]
  );

  const cafe = result.rows[0];
  const token = generateToken(cafe.id, cafe.slug, 'OWNER');
  logger.info('Owner account created: %s (%s)', cafe.email, cafe.id);
  ok(res, { token, cafe, role: 'OWNER' }, 'Account created successfully', 201);
});

exports.validateCompleteSetup = [
  body('name').trim().notEmpty().withMessage('Cafe name is required'),
  body('slug')
    .trim()
    .notEmpty().withMessage('Slug is required')
    .matches(/^[a-z0-9-]+$/).withMessage('Slug can only contain lowercase letters, numbers, and hyphens'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
];

exports.completeSetup = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const {
    name, slug, description, address, address_line2, city, state, pincode, phone,
    gst_number, gst_rate, fssai_number, upi_id, bill_prefix, bill_footer,
    pan_number, tax_inclusive, business_type, country, currency = 'INR',
    latitude: manualLatitude, longitude: manualLongitude,
  } = req.body;

  const currentRes = await db.query(
    'SELECT id, email, setup_completed FROM cafes WHERE id = $1 AND is_active = true',
    [req.cafeId]
  );
  if (currentRes.rows.length === 0) return fail(res, 'Account not found', 404);

  const conflict = await db.query(
    'SELECT id, is_active FROM cafes WHERE slug = $1 AND id != $2',
    [slug.trim(), req.cafeId]
  );
  const activeConflict = conflict.rows.filter((r) => r.is_active !== false);
  if (activeConflict.length > 0) return fail(res, 'This slug is already taken', 409, 'SLUG_TAKEN');

  let gstVerified = false;
  if (gst_number && gst_number.trim()) {
    gstVerified = validateGstin(gst_number).valid;
  }

  const geocoded = (!manualLatitude && !manualLongitude)
    ? await geocodeAddress([address, address_line2, city, state, pincode, country])
    : null;
  const latitude = manualLatitude || geocoded?.latitude || null;
  const longitude = manualLongitude || geocoded?.longitude || null;

  const result = await db.query(
    `UPDATE cafes
     SET name            = $1,
         slug            = $2,
         description     = $3,
         address         = $4,
         address_line2   = $5,
         city            = $6,
         state           = $7,
         pincode         = $8,
         phone           = $9,
         gst_number      = $10,
         gst_rate        = COALESCE($11, gst_rate),
         fssai_number    = $12,
         upi_id          = $13,
         bill_prefix     = COALESCE($14, bill_prefix),
         bill_footer     = $15,
         pan_number      = $16,
         tax_inclusive   = COALESCE($17, tax_inclusive),
         gst_verified    = $18,
         business_type   = COALESCE($19, business_type),
         country         = COALESCE($20, country),
         currency        = COALESCE($21, currency),
         latitude        = COALESCE($22, latitude),
         longitude       = COALESCE($23, longitude),
         setup_completed = true
     WHERE id = $24
     RETURNING id, name, slug, email, description,
               address, address_line2, city, state, pincode, phone,
               logo_url, cover_image_url, name_style, latitude, longitude,
               gst_number, gst_rate, fssai_number, upi_id, bill_prefix, bill_footer,
               pan_number, tax_inclusive, gst_verified, business_type, country,
               COALESCE(currency, 'INR') AS currency,
               plan_type, plan_start_date, plan_expiry_date, created_at, setup_completed`,
    [
      name.trim(), slug.trim(), description || null, address || null, address_line2 || null,
      city || null, state || null, pincode || null, phone.trim(),
      gst_number || null, gst_rate != null ? parseInt(gst_rate, 10) : null,
      fssai_number || null, upi_id || null, bill_prefix || null, bill_footer || null,
      pan_number || null, tax_inclusive != null ? Boolean(tax_inclusive) : null, gstVerified,
      business_type || null, country || null, currency || null, latitude, longitude, req.cafeId,
    ]
  );

  const existingTables = await db.query('SELECT id FROM cafe_tables WHERE cafe_id = $1 LIMIT 1', [req.cafeId]);
  if (existingTables.rows.length === 0) {
    await db.query(
      'INSERT INTO cafe_tables (cafe_id, label) VALUES ($1, $2), ($1, $3)',
      [req.cafeId, 'Table 1', 'Table 2']
    ).catch(() => {});
  }

  const cafe = result.rows[0];
  const token = generateToken(cafe.id, cafe.slug, 'OWNER');
  logger.info('Cafe setup completed: %s (%s)', cafe.name, cafe.slug);
  ok(res, { token, cafe, role: 'OWNER' }, 'Cafe setup completed successfully');
});

// ─── Register ─────────────────────────────────────────────────
exports.validateRegister = [
  body('name').trim().notEmpty().withMessage('Café name is required'),
  body('slug')
    .trim()
    .notEmpty().withMessage('Slug is required')
    .matches(/^[a-z0-9-]+$/).withMessage('Slug can only contain lowercase letters, numbers, and hyphens'),
  body('email').isEmail().withMessage('Valid email is required').customSanitizer(v => v.trim().toLowerCase()),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  // otp is no longer required — emailVerifiedToken is the preferred path
];

exports.register = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { name, slug, email, password, otp, emailVerifiedToken, description,
          address, address_line2, city, state, pincode, phone,
          currency = 'INR' } = req.body;

  // Verify email ownership via token (preferred) or raw OTP (fallback)
  if (emailVerifiedToken) {
    try {
      const decoded = jwt.verify(emailVerifiedToken, process.env.JWT_SECRET);
      if (decoded.purpose !== 'email_verified' || decoded.email !== email) {
        return fail(res, 'Email verification token is invalid or does not match', 400, 'TOKEN_MISMATCH');
      }
    } catch {
      return fail(res, 'Email verification token is expired or invalid — please verify your email again', 400, 'TOKEN_EXPIRED');
    }
  } else if (otp) {
    const otpCheck = await verifyOtp(email, otp, 'register');
    if (!otpCheck.valid) {
      const codeMap = {
        'No OTP sent to this email':                              'OTP_NOT_SENT',
        'OTP expired — please request a new one':                 'OTP_EXPIRED',
        'Incorrect verification code':                            'OTP_WRONG',
        'Too many incorrect attempts — please request a new code':'OTP_MAX_ATTEMPTS',
      };
      return fail(res, otpCheck.reason, 400, codeMap[otpCheck.reason] || 'OTP_INVALID');
    }
  } else {
    return fail(res, 'Email verification is required — please verify your email first', 400, 'OTP_NOT_SENT');
  }

  // Only block active accounts — deactivated cafes free up email/slug for re-registration
  const existing = await db.query(
    'SELECT id, is_active FROM cafes WHERE slug = $1 OR email = $2',
    [slug, email]
  );
  const activeConflict = existing.rows.filter((r) => r.is_active !== false);
  if (activeConflict.length > 0) return fail(res, 'Slug or email already in use', 409, 'SLUG_OR_EMAIL_TAKEN');

  const password_hash = await bcrypt.hash(password, 12);
  // Check if migration 016 (address_line2, state, pincode) has been applied
  const addrColCheck = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'cafes' AND column_name = 'address_line2'`
  );
  const hasMig016 = addrColCheck.rows.length > 0;

  const result = hasMig016
    ? await db.query(
        `INSERT INTO cafes (name, slug, email, password_hash, description,
                            address, address_line2, city, state, pincode, phone,
                            currency, plan_type, plan_start_date, plan_expiry_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'free_trial',NOW(),NOW() + INTERVAL '1 month')
         RETURNING id, name, slug, email, description,
                   address, address_line2, city, state, pincode, phone,
                   currency, plan_type, plan_start_date, plan_expiry_date, created_at`,
        [name, slug, email, password_hash, description || null,
         address || null, address_line2 || null, city || null, state || null, pincode || null,
         phone || null, currency || 'INR']
      )
    : await db.query(
        `INSERT INTO cafes (name, slug, email, password_hash, description,
                            address, city, phone,
                            currency, plan_type, plan_start_date, plan_expiry_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'free_trial',NOW(),NOW() + INTERVAL '1 month')
         RETURNING id, name, slug, email, description,
                   address, city, phone,
                   currency, plan_type, plan_start_date, plan_expiry_date, created_at`,
        [name, slug, email, password_hash, description || null,
         address || null, city || null, phone || null, currency || 'INR']
      );

  const cafe = result.rows[0];

  // Seed default tables so the setup wizard has something to start with
  await db.query(
    'INSERT INTO cafe_tables (cafe_id, label) VALUES ($1, $2), ($1, $3)',
    [cafe.id, 'Table 1', 'Table 2']
  ).catch(() => {});

  const token = generateToken(cafe.id, cafe.slug, 'OWNER');
  logger.info('New café registered: %s (%s)', cafe.name, cafe.slug);
  ok(res, { token, cafe }, 'Café registered successfully', 201);
});

// ─── Login ────────────────────────────────────────────────────
// Accepts email OR phone number. Checks owners first, then staff.
exports.validateLogin = [
  body('identifier').trim().notEmpty().withMessage('Email or phone number is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

exports.login = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { identifier, password } = req.body;
  const id = identifier.trim().toLowerCase();

  try {
    // 1. Check owner accounts — match by email OR phone
    const ownerResult = await db.query(
      `SELECT id, name, slug, email, password_hash, description, address, phone, logo_url,
              COALESCE(setup_completed, true) AS setup_completed,
              COALESCE(token_version, 1) AS token_version
       FROM cafes WHERE (email = $1 OR phone = $1) AND is_active = true`,
      [id]
    );

    if (ownerResult.rows.length > 0) {
      const cafe = ownerResult.rows[0];
      if (!cafe.password_hash) {
        logger.warn('Login failed - missing password_hash for cafe id %s', cafe.id);
        return fail(res, 'Invalid credentials', 401, 'INVALID_CREDENTIALS');
      }

      const isValid = await bcrypt.compare(password, cafe.password_hash);
      if (!isValid) return fail(res, 'Invalid credentials', 401, 'INVALID_CREDENTIALS');

      const { password_hash, token_version, ...cafeData } = cafe;
      const token = generateToken(cafe.id, cafe.slug, 'OWNER', null, null, null, token_version);
      return ok(res, { token, cafe: cafeData, role: 'OWNER' }, 'Login successful');
    }

    // 2. Check staff accounts — match by email
    const staffResult = await db.query(
      `SELECT cs.id AS staff_id, cs.name, cs.email, cs.password_hash, cs.role AS staff_role,
              c.id AS cafe_id, c.slug, c.name AS cafe_name
       FROM cafe_staff cs
       JOIN cafes c ON cs.cafe_id = c.id
       WHERE cs.email = $1 AND cs.is_active = true AND c.is_active = true`,
      [id]
    );

    if (staffResult.rows.length > 0) {
      const staff = staffResult.rows[0];
      if (!staff.password_hash) {
        logger.warn('Login failed - missing password_hash for staff id %s', staff.staff_id);
        return fail(res, 'Invalid credentials', 401, 'INVALID_CREDENTIALS');
      }

      const isValid = await bcrypt.compare(password, staff.password_hash);
      if (!isValid) return fail(res, 'Invalid credentials', 401, 'INVALID_CREDENTIALS');

      const token = generateToken(staff.cafe_id, staff.slug, 'STAFF', staff.staff_id, null, staff.staff_role);
      return ok(res, {
        token,
        cafe: { id: staff.cafe_id, slug: staff.slug, name: staff.cafe_name },
        role: 'STAFF',
        staffRole: staff.staff_role,
        staff: { id: staff.staff_id, name: staff.name, email: staff.email },
      }, 'Login successful');
    }

    return fail(res, 'Invalid credentials', 401, 'INVALID_CREDENTIALS');
  } catch (err) {
    logger.error('Login handler error: %s', err.stack || err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ─── Check Slug ───────────────────────────────────────────────
exports.checkSlug = asyncHandler(async (req, res) => {
  const { slug } = req.query;
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return fail(res, 'Invalid slug format');
  const result = await db.query('SELECT id FROM cafes WHERE slug = $1', [slug]);
  ok(res, { available: result.rows.length === 0 });
});

// ─── Get Me ───────────────────────────────────────────────────
exports.getMe = asyncHandler(async (req, res) => {
  // Try full query (migration 016 applied); fall back to base columns if not
  let result;
  try {
    result = await db.query(
      `SELECT id, name, slug, email, description,
              address, address_line2, city, state, pincode,
              phone, logo_url, cover_image_url,
              name_style, latitude, longitude,
              gst_number, gst_rate, fssai_number, upi_id, bill_prefix, bill_footer,
              pan_number, tax_inclusive, gst_verified, business_type, country,
              COALESCE(setup_completed, true) AS setup_completed,
              COALESCE(currency, 'INR') AS currency,
              opening_hours, COALESCE(timezone, 'Asia/Kolkata') AS timezone,
              plan_type, plan_tier, plan_start_date, plan_expiry_date, created_at,
              parent_cafe_id,
              COALESCE(delivery_enabled, false)   AS delivery_enabled,
              COALESCE(delivery_radius_km, 5)     AS delivery_radius_km,
              COALESCE(delivery_fee_base, 0)      AS delivery_fee_base,
              COALESCE(delivery_fee_per_km, 0)    AS delivery_fee_per_km,
              COALESCE(delivery_min_order, 0)     AS delivery_min_order,
              COALESCE(delivery_est_mins, 30)     AS delivery_est_mins
       FROM cafes WHERE id = $1`,
      [req.cafeId]
    );
  } catch {
    result = await db.query(
      `SELECT id, name, slug, email, description,
              address, city, phone, logo_url, cover_image_url,
              name_style, latitude, longitude,
              gst_number, gst_rate, fssai_number, upi_id, bill_prefix, bill_footer,
              COALESCE(setup_completed, true) AS setup_completed,
              COALESCE(currency, 'INR') AS currency,
              plan_type, plan_tier, plan_start_date, plan_expiry_date, created_at
       FROM cafes WHERE id = $1`,
      [req.cafeId]
    );
  }
  if (result.rows.length === 0) return fail(res, 'Café not found', 404);

  // For staff sessions, also return name + role
  if (req.staffId) {
    const staffRow = await db.query(
      'SELECT id, name, email, role FROM cafe_staff WHERE id = $1 AND cafe_id = $2',
      [req.staffId, req.cafeId]
    );
    const staffData = staffRow.rows[0] || null;
    return ok(res, {
      cafe:      { ...result.rows[0], root_cafe_id: req.rootCafeId },
      staff:     staffData,
      staffRole: staffData?.role || null,
    });
  }

  ok(res, { cafe: { ...result.rows[0], root_cafe_id: req.rootCafeId } });
});

// ─── Update Profile ───────────────────────────────────────────
// ── GSTIN format validator (India) ────────────────────────────
// Pattern: 2-digit state code + 10-char PAN + entity digit + Z + checksum
exports.updateProfile = asyncHandler(async (req, res) => {
  const {
    name, description,
    address, address_line2, city, state, pincode,
    phone, logo_url, cover_image_url,
    name_style, latitude, longitude,
    gst_number, gst_rate, fssai_number, upi_id, bill_prefix, bill_footer,
    pan_number, tax_inclusive, business_type, country,
    opening_hours, timezone,
    delivery_enabled, delivery_radius_km, delivery_fee_base,
    delivery_fee_per_km, delivery_min_order, delivery_est_mins,
    currency,
  } = req.body;

  // Validate GSTIN format if provided — set gst_verified accordingly
  let gstVerified = false;
  if (gst_number && gst_number.trim()) {
    const check = validateGstin(gst_number);
    gstVerified = check.valid;
  }

  if (!phone || !phone.trim()) return fail(res, 'Phone number is required');

  const geocoded = (!latitude && !longitude)
    ? await geocodeAddress([address, address_line2, city, state, pincode, country])
    : null;
  const nextLatitude = latitude || geocoded?.latitude || null;
  const nextLongitude = longitude || geocoded?.longitude || null;

  // Try update with new address fields (migration 016); fall back to base columns if not applied
  let result;
  try {
    result = await db.query(
      `UPDATE cafes
       SET name            = COALESCE($1,  name),
           description     = COALESCE($2,  description),
           address         = COALESCE($3,  address),
           address_line2   = $4,
           city            = COALESCE($5,  city),
           state           = $6,
           pincode         = $7,
           phone           = $8,
           logo_url        = COALESCE($9,  logo_url),
           cover_image_url = COALESCE($10, cover_image_url),
           name_style      = COALESCE($11, name_style),
           latitude        = COALESCE($12, latitude),
           longitude       = COALESCE($13, longitude),
           gst_number      = COALESCE($14, gst_number),
           gst_rate        = COALESCE($15, gst_rate),
           fssai_number    = COALESCE($16, fssai_number),
           upi_id          = COALESCE($17, upi_id),
           bill_prefix     = COALESCE($18, bill_prefix),
           bill_footer     = COALESCE($19, bill_footer),
           pan_number      = $20,
           tax_inclusive   = COALESCE($21, tax_inclusive),
           gst_verified    = $22,
           business_type   = COALESCE($23, business_type),
           country         = COALESCE($24, country),
           opening_hours      = COALESCE($25::jsonb, opening_hours),
           timezone           = COALESCE($26, timezone),
           delivery_enabled   = COALESCE($28, delivery_enabled),
           delivery_radius_km = COALESCE($29, delivery_radius_km),
           delivery_fee_base  = COALESCE($30, delivery_fee_base),
           delivery_fee_per_km = COALESCE($31, delivery_fee_per_km),
           delivery_min_order = COALESCE($32, delivery_min_order),
           delivery_est_mins  = COALESCE($33, delivery_est_mins),
           currency           = COALESCE($34, currency)
       WHERE id = $27
       RETURNING id, name, slug, email, description,
                 address, address_line2, city, state, pincode,
                 phone, logo_url, cover_image_url, name_style, latitude, longitude,
                 gst_number, gst_rate, fssai_number, upi_id, bill_prefix, bill_footer,
                 pan_number, tax_inclusive, gst_verified, business_type, country,
                 COALESCE(currency, 'INR') AS currency,
                 opening_hours, timezone, parent_cafe_id,
                 COALESCE(delivery_enabled, false)    AS delivery_enabled,
                 COALESCE(delivery_radius_km, 5)      AS delivery_radius_km,
                 COALESCE(delivery_fee_base, 0)       AS delivery_fee_base,
                 COALESCE(delivery_fee_per_km, 0)     AS delivery_fee_per_km,
                 COALESCE(delivery_min_order, 0)      AS delivery_min_order,
                 COALESCE(delivery_est_mins, 30)      AS delivery_est_mins`,
      [name, description,
       address, address_line2 || null, city || null, state || null, pincode || null,
       phone.trim(), logo_url, cover_image_url,
       name_style || null, nextLatitude, nextLongitude,
       gst_number || null, gst_rate != null ? parseInt(gst_rate) : null,
       fssai_number || null, upi_id || null,
       bill_prefix || null, bill_footer || null,
       pan_number || null,
       tax_inclusive != null ? Boolean(tax_inclusive) : null,
       gstVerified,
       business_type || null, country || null,
       opening_hours ? JSON.stringify(opening_hours) : null,
       timezone || null,
       req.cafeId,
       delivery_enabled != null ? Boolean(delivery_enabled) : null,
       delivery_radius_km != null ? parseFloat(delivery_radius_km) : null,
       delivery_fee_base != null ? parseFloat(delivery_fee_base) : null,
       delivery_fee_per_km != null ? parseFloat(delivery_fee_per_km) : null,
       delivery_min_order != null ? parseFloat(delivery_min_order) : null,
       delivery_est_mins != null ? parseInt(delivery_est_mins) : null,
       currency || null]
    );
  } catch {
    // Migration 016/027 not applied — fall back to base columns only
    result = await db.query(
      `UPDATE cafes
       SET name            = COALESCE($1,  name),
           description     = COALESCE($2,  description),
           address         = COALESCE($3,  address),
           city            = COALESCE($4,  city),
           phone           = $5,
           logo_url        = COALESCE($6,  logo_url),
           cover_image_url = COALESCE($7,  cover_image_url),
           name_style      = COALESCE($8,  name_style),
           latitude        = COALESCE($9,  latitude),
           longitude       = COALESCE($10, longitude),
           gst_number      = COALESCE($11, gst_number),
           gst_rate        = COALESCE($12, gst_rate),
           fssai_number    = COALESCE($13, fssai_number),
           upi_id          = COALESCE($14, upi_id),
           bill_prefix     = COALESCE($15, bill_prefix),
           bill_footer     = COALESCE($16, bill_footer)
       WHERE id = $17
       RETURNING id, name, slug, email, description,
                 address, city, phone, logo_url, cover_image_url,
                 name_style, latitude, longitude,
                 gst_number, gst_rate, fssai_number, upi_id, bill_prefix, bill_footer`,
      [name, description, address, city || null, phone.trim(),
       logo_url, cover_image_url,
       name_style || null, nextLatitude, nextLongitude,
       gst_number || null, gst_rate != null ? parseInt(gst_rate) : null,
       fssai_number || null, upi_id || null,
       bill_prefix || null, bill_footer || null,
       req.cafeId]
    );
  }
  await cache.del(`cafe:${result.rows[0].slug}`);
  ok(res, { cafe: { ...result.rows[0], root_cafe_id: req.rootCafeId } });
});

// ─── Outlets: create an outlet under the current root café ───────
exports.createOutlet = asyncHandler(async (req, res) => {
  const { name, slug, address, address_line2, city, state, pincode, phone, description } = req.body;
  if (!name?.trim()) return fail(res, 'Outlet name is required');
  if (!slug?.trim()) return fail(res, 'Outlet slug is required');
  if (!/^[a-z0-9-]+$/.test(slug)) return fail(res, 'Slug can only contain lowercase letters, numbers, and hyphens');

  // Owners can only create outlets for their root café
  const parentId = req.rootCafeId;

  // Verify parent exists and current user owns it
  const parentCheck = await db.query(
    'SELECT id FROM cafes WHERE id = $1 AND (id = $2 OR parent_cafe_id = $2)',
    [parentId, req.cafeId]
  );
  if (parentCheck.rows.length === 0) {
    // Re-check: current cafe IS the root
    const rootCheck = await db.query('SELECT id FROM cafes WHERE id = $1', [req.cafeId]);
    if (rootCheck.rows.length === 0) return fail(res, 'Not authorized to create outlets', 403);
  }

  const existing = await db.query('SELECT id FROM cafes WHERE slug = $1', [slug]);
  if (existing.rows.length > 0) return fail(res, 'This slug is already taken', 409);

  const geocoded = await geocodeAddress([address, address_line2, city, state, pincode]);

  const result = await db.query(
    `INSERT INTO cafes
       (name, slug, email, password_hash, description,
        address, address_line2, city, state, pincode, phone,
        latitude, longitude, parent_cafe_id, plan_type, plan_start_date, plan_expiry_date)
     SELECT $1,$2,c.email,c.password_hash,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
            c.plan_type,c.plan_start_date,c.plan_expiry_date
     FROM cafes c WHERE c.id = $13
     RETURNING id, name, slug, description, address, address_line2, city, state, pincode, phone, latitude, longitude, parent_cafe_id`,
    [name.trim(), slug.trim(), description || null,
     address || null, address_line2 || null, city || null,
     state || null, pincode || null, phone || null,
     geocoded?.latitude || null, geocoded?.longitude || null, parentId, parentId]
  );
  logger.info('New outlet created: %s (%s) under %s', name, slug, parentId);
  ok(res, { outlet: result.rows[0] }, 'Outlet created successfully', 201);
});

// ─── Outlets: list all cafes in the same group (root + outlets) ──
exports.getOutlets = asyncHandler(async (req, res) => {
  const rootId = req.rootCafeId;
  // Check if migration 016 has been applied
  const colCheck = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'cafes' AND column_name = 'parent_cafe_id'`
  );
  if (colCheck.rows.length === 0) {
    // Migration not applied — return just the current café as a single-item list
    return ok(res, { outlets: [{ id: req.cafeId, name: null, slug: req.cafeSlug, parent_cafe_id: null }], root_cafe_id: rootId });
  }
  const result = await db.query(
    `SELECT id, name, slug, address, city, state, phone, parent_cafe_id
     FROM cafes
     WHERE id = $1 OR parent_cafe_id = $1
     ORDER BY parent_cafe_id NULLS FIRST, name ASC`,
    [rootId]
  );
  ok(res, { outlets: result.rows, root_cafe_id: rootId });
});

// ─── Outlets: switch active outlet — returns new JWT ─────────────
exports.switchOutlet = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const rootId  = req.rootCafeId;

  // Target must be root itself OR an outlet of the root
  const target = await db.query(
    `SELECT id, name, slug, parent_cafe_id FROM cafes
     WHERE id = $1 AND (id = $2 OR parent_cafe_id = $2) AND is_active = true`,
    [id, rootId]
  );
  if (target.rows.length === 0) return fail(res, 'Outlet not found or not authorized', 404);

  const outlet = target.rows[0];
  const token = generateToken(outlet.id, outlet.slug, 'OWNER', null, rootId);
  ok(res, { token, cafe_id: outlet.id, slug: outlet.slug, name: outlet.name });
});

// ─── Forgot Password — send reset OTP via email (Brevo SMTP) ──
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) return fail(res, 'Valid email is required');

  // Check both owners and staff
  const ownerRes = await db.query(
    'SELECT id FROM cafes WHERE email = $1 AND is_active = true',
    [email.toLowerCase()]
  );
  const staffRes = ownerRes.rows.length === 0
    ? await db.query('SELECT id FROM cafe_staff WHERE email = $1 AND is_active = true', [email.toLowerCase()])
    : { rows: [] };

  if (ownerRes.rows.length === 0 && staffRes.rows.length === 0) {
    return fail(res, 'No account found with this email address', 404);
  }

  try {
    const otp = await createOtp(email, 'reset');
    await sendPasswordResetEmail(email, otp);
    ok(res, {}, 'Password reset code sent to your email');
  } catch (error) {
    logger.error('Failed to send reset email: %s', error.message);
    return fail(res, 'Failed to send reset email. Please try again later.');
  }
});

// ─── Reset Password — verify OTP + set new password ───────────
exports.validateResetPassword = [
  body('email').isEmail().withMessage('Valid email is required').customSanitizer(v => v.trim().toLowerCase()),
  body('otp').trim().notEmpty().withMessage('Reset code is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

exports.resetPassword = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { email, otp, password } = req.body;

  const otpCheck = await verifyOtp(email, otp, 'reset');
  if (!otpCheck.valid) return fail(res, otpCheck.reason);

  const password_hash = await bcrypt.hash(password, 12);

  // Try owner table first, then staff
  const updateOwner = await db.query(
    'UPDATE cafes SET password_hash = $1 WHERE email = $2 AND is_active = true RETURNING id',
    [password_hash, email.toLowerCase()]
  );

  if (updateOwner.rowCount === 0) {
    const updateStaff = await db.query(
      'UPDATE cafe_staff SET password_hash = $1 WHERE email = $2 AND is_active = true RETURNING id',
      [password_hash, email.toLowerCase()]
    );
    if (updateStaff.rowCount === 0) return fail(res, 'Account not found', 404);
  }

  logger.info('Password reset for: %s', email);
  ok(res, {}, 'Password updated successfully — you can now log in');
});

// ─── DELETE /api/auth/me ──────────────────────────────────────
// action=deactivate  → sets is_active=false (reversible by admin)
// action=delete      → hard deletes the café and all its data
exports.deleteCafe = asyncHandler(async (req, res) => {
  const { action, confirm_name } = req.body;

  if (!['deactivate', 'delete'].includes(action)) {
    return fail(res, 'action must be "deactivate" or "delete"');
  }

  const cafeRes = await db.query('SELECT id, name FROM cafes WHERE id = $1', [req.cafeId]);
  if (cafeRes.rows.length === 0) return fail(res, 'Café not found', 404);
  const cafe = cafeRes.rows[0];

  // Require typed confirmation matching café name
  if (!confirm_name || confirm_name.trim().toLowerCase() !== cafe.name.trim().toLowerCase()) {
    return fail(res, 'Confirmation name does not match your café name', 400);
  }

  if (action === 'deactivate') {
    await db.query('UPDATE cafes SET is_active = false WHERE id = $1', [req.cafeId]);
    logger.info('Café deactivated: %s (%s)', cafe.name, req.cafeId);
    return ok(res, {}, 'Café deactivated. Contact support to reactivate.');
  }

  // Hard delete — relies on CASCADE constraints on FK references
  await db.query('DELETE FROM cafes WHERE id = $1', [req.cafeId]);
  logger.info('Café hard-deleted: %s (%s)', cafe.name, req.cafeId);
  ok(res, {}, 'Café and all associated data permanently deleted.');
});
