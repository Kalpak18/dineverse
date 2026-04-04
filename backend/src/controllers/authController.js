const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { createOtp, verifyOtp } = require('../utils/otpStore');
const { sendOtpEmail, sendPasswordResetEmail } = require('../services/emailService');
const logger = require('../utils/logger');
const { ok, fail, validationFail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// role: 'OWNER' | 'STAFF'
// rootCafeId: the brand account's ID — outlets inherit the parent's subscription
const generateToken = (cafeId, slug, role = 'OWNER', staffId = null, rootCafeId = null) => {
  const payload = { cafeId, slug, role, rootCafeId: rootCafeId || cafeId };
  if (staffId) payload.staffId = staffId;
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ─── Send OTP (registration) ──────────────────────────────────
exports.sendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  logger.info('Send OTP request received:', { email, hasEmail: !!email, emailType: typeof email });

  if (!email || !isValidEmail(email)) {
    logger.warn('Email validation failed:', { email, isEmpty: !email, isValid: isValidEmail(email || '') });
    return fail(res, 'Valid email is required');
  }

  // Check if SMTP is configured
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.error('SMTP not configured - cannot send OTP email');
    return fail(res, 'Email service is not configured. Please contact support.');
  }

  try {
    const otp = await createOtp(email, 'register');
    await sendOtpEmail(email, otp);
    ok(res, {}, 'Verification code sent');
  } catch (error) {
    logger.error('❌ FULL OTP ERROR:', error);
    return fail(res, 'Failed to send verification email. Please try again later.');
  }
});

// ─── Register ─────────────────────────────────────────────────
exports.validateRegister = [
  body('name').trim().notEmpty().withMessage('Café name is required'),
  body('slug')
    .trim()
    .notEmpty().withMessage('Slug is required')
    .matches(/^[a-z0-9-]+$/).withMessage('Slug can only contain lowercase letters, numbers, and hyphens'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('otp').trim().notEmpty().withMessage('Email verification code is required'),
];

exports.register = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { name, slug, email, password, otp, description,
          address, address_line2, city, state, pincode, phone } = req.body;

  // Verify OTP before touching the database
  const otpCheck = await verifyOtp(email, otp, 'register');
  if (!otpCheck.valid) return fail(res, otpCheck.reason);

  const existing = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 OR email = $2',
    [slug, email]
  );
  if (existing.rows.length > 0) return fail(res, 'Slug or email already in use', 409);

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
                            plan_type, plan_start_date, plan_expiry_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'free_trial',NOW(),NOW() + INTERVAL '1 month')
         RETURNING id, name, slug, email, description,
                   address, address_line2, city, state, pincode, phone,
                   plan_type, plan_start_date, plan_expiry_date, created_at`,
        [name, slug, email, password_hash, description || null,
         address || null, address_line2 || null, city || null, state || null, pincode || null,
         phone || null]
      )
    : await db.query(
        `INSERT INTO cafes (name, slug, email, password_hash, description,
                            address, city, phone,
                            plan_type, plan_start_date, plan_expiry_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'free_trial',NOW(),NOW() + INTERVAL '1 month')
         RETURNING id, name, slug, email, description,
                   address, city, phone,
                   plan_type, plan_start_date, plan_expiry_date, created_at`,
        [name, slug, email, password_hash, description || null,
         address || null, city || null, phone || null]
      );

  const cafe = result.rows[0];

  // Seed default data so the setup wizard is usable immediately
  await Promise.allSettled([
    db.query(
      'INSERT INTO categories (cafe_id, name, display_order) VALUES ($1, $2, 0)',
      [cafe.id, 'General']
    ),
    db.query(
      'INSERT INTO cafe_tables (cafe_id, label) VALUES ($1, $2), ($1, $3)',
      [cafe.id, 'Table 1', 'Table 2']
    ),
  ]);

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
      `SELECT id, name, slug, email, password_hash, description, address, phone, logo_url
       FROM cafes WHERE (email = $1 OR phone = $1) AND is_active = true`,
      [id]
    );

    if (ownerResult.rows.length > 0) {
      const cafe = ownerResult.rows[0];
      if (!cafe.password_hash) {
        logger.warn('Login failed - missing password_hash for cafe id %s', cafe.id);
        return fail(res, 'Invalid credentials', 401);
      }

      const isValid = await bcrypt.compare(password, cafe.password_hash);
      if (!isValid) return fail(res, 'Invalid credentials', 401);

      const { password_hash, ...cafeData } = cafe;
      const token = generateToken(cafe.id, cafe.slug, 'OWNER');
      return ok(res, { token, cafe: cafeData, role: 'OWNER' }, 'Login successful');
    }

    // 2. Check staff accounts — match by email OR phone
    const staffResult = await db.query(
      `SELECT cs.id AS staff_id, cs.name, cs.email, cs.password_hash,
              c.id AS cafe_id, c.slug, c.name AS cafe_name
       FROM cafe_staff cs
       JOIN cafes c ON cs.cafe_id = c.id
       WHERE (cs.email = $1 OR cs.phone = $1) AND cs.is_active = true AND c.is_active = true`,
      [id]
    );

    if (staffResult.rows.length > 0) {
      const staff = staffResult.rows[0];
      if (!staff.password_hash) {
        logger.warn('Login failed - missing password_hash for staff id %s', staff.staff_id);
        return fail(res, 'Invalid credentials', 401);
      }

      const isValid = await bcrypt.compare(password, staff.password_hash);
      if (!isValid) return fail(res, 'Invalid credentials', 401);

      const token = generateToken(staff.cafe_id, staff.slug, 'STAFF', staff.staff_id);
      return ok(res, {
        token,
        cafe: { id: staff.cafe_id, slug: staff.slug, name: staff.cafe_name },
        role: 'STAFF',
        staff: { id: staff.staff_id, name: staff.name, email: staff.email },
      }, 'Login successful');
    }

    return fail(res, 'Invalid credentials', 401);
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
              plan_type, plan_start_date, plan_expiry_date, created_at,
              parent_cafe_id
       FROM cafes WHERE id = $1`,
      [req.cafeId]
    );
  } catch {
    result = await db.query(
      `SELECT id, name, slug, email, description,
              address, city, phone, logo_url, cover_image_url,
              name_style, latitude, longitude,
              gst_number, gst_rate, fssai_number, upi_id, bill_prefix, bill_footer,
              plan_type, plan_start_date, plan_expiry_date, created_at
       FROM cafes WHERE id = $1`,
      [req.cafeId]
    );
  }
  if (result.rows.length === 0) return fail(res, 'Café not found', 404);
  ok(res, { cafe: { ...result.rows[0], root_cafe_id: req.rootCafeId } });
});

// ─── Update Profile ───────────────────────────────────────────
exports.updateProfile = asyncHandler(async (req, res) => {
  const {
    name, description,
    address, address_line2, city, state, pincode,
    phone, logo_url, cover_image_url,
    name_style, latitude, longitude,
    gst_number, gst_rate, fssai_number, upi_id, bill_prefix, bill_footer,
  } = req.body;

  if (!phone || !phone.trim()) return fail(res, 'Phone number is required');

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
           bill_footer     = COALESCE($19, bill_footer)
       WHERE id = $20
       RETURNING id, name, slug, email, description,
                 address, address_line2, city, state, pincode,
                 phone, logo_url, cover_image_url, name_style, latitude, longitude,
                 gst_number, gst_rate, fssai_number, upi_id, bill_prefix, bill_footer,
                 parent_cafe_id`,
      [name, description,
       address, address_line2 || null, city || null, state || null, pincode || null,
       phone.trim(), logo_url, cover_image_url,
       name_style || null, latitude || null, longitude || null,
       gst_number || null, gst_rate != null ? parseInt(gst_rate) : null,
       fssai_number || null, upi_id || null,
       bill_prefix || null, bill_footer || null,
       req.cafeId]
    );
  } catch {
    // Migration 016 not applied — fall back to base columns only
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
       name_style || null, latitude || null, longitude || null,
       gst_number || null, gst_rate != null ? parseInt(gst_rate) : null,
       fssai_number || null, upi_id || null,
       bill_prefix || null, bill_footer || null,
       req.cafeId]
    );
  }
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

  const result = await db.query(
    `INSERT INTO cafes
       (name, slug, email, password_hash, description,
        address, address_line2, city, state, pincode, phone,
        parent_cafe_id, plan_type, plan_start_date, plan_expiry_date)
     SELECT $1,$2,c.email,c.password_hash,$3,$4,$5,$6,$7,$8,$9,$10,
            c.plan_type,c.plan_start_date,c.plan_expiry_date
     FROM cafes c WHERE c.id = $11
     RETURNING id, name, slug, description, address, address_line2, city, state, pincode, phone, parent_cafe_id`,
    [name.trim(), slug.trim(), description || null,
     address || null, address_line2 || null, city || null,
     state || null, pincode || null, phone || null,
     parentId, parentId]
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

// ─── Forgot Password — send reset OTP ─────────────────────────
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) return fail(res, 'Valid email is required');

  // Check if SMTP is configured
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.error('SMTP not configured - cannot send password reset email');
    return fail(res, 'Email service is not configured. Please contact support.');
  }

  // Check both cafes (owners) and cafe_staff
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
    logger.error('Failed to send password reset email:', error.message);
    return fail(res, 'Failed to send password reset email. Please try again later.');
  }
});

// ─── Reset Password — verify OTP + set new password ───────────
exports.validateResetPassword = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
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
  const ownerRes = await db.query(
    'UPDATE cafes SET password_hash = $1 WHERE email = $2 AND is_active = true RETURNING id',
    [password_hash, email.toLowerCase()]
  );

  if (ownerRes.rowCount === 0) {
    const staffRes = await db.query(
      'UPDATE cafe_staff SET password_hash = $1 WHERE email = $2 AND is_active = true RETURNING id',
      [password_hash, email.toLowerCase()]
    );
    if (staffRes.rowCount === 0) return fail(res, 'Account not found', 404);
  }

  logger.info('Password reset for: %s', email);
  ok(res, {}, 'Password updated successfully — you can now log in');
});
