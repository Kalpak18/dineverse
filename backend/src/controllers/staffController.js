const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { ok, fail, validationFail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

exports.validateStaff = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required').customSanitizer((v) => v.trim().toLowerCase()),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

// Owner: list all staff for this café
exports.getStaff = asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT id, name, email, role, is_active, created_at FROM cafe_staff WHERE cafe_id = $1 ORDER BY created_at ASC',
    [req.cafeId]
  );
  ok(res, { staff: result.rows });
});

// Owner: create a staff account
exports.createStaff = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { name, email, password, role } = req.body;
  const VALID_ROLES = ['cashier', 'kitchen', 'manager'];
  const staffRole = VALID_ROLES.includes(role) ? role : 'cashier';

  const existing = await db.query(
    'SELECT id FROM cafe_staff WHERE email = $1 AND cafe_id = $2',
    [email, req.cafeId]
  );
  if (existing.rows.length > 0) {
    return fail(res, 'A staff account with this email already exists', 409);
  }

  const STAFF_LIMITS = { free_trial: 3, basic: 5 }; // premium = unlimited
  const planTier = req.subscription?.plan_tier || 'free_trial';
  const planType = req.subscription?.plan_type;
  const limit = STAFF_LIMITS[planType === 'free_trial' ? 'free_trial' : (planTier || 'basic')];
  if (limit !== undefined) {
    const countRes = await db.query(
      'SELECT COUNT(*)::int AS cnt FROM cafe_staff WHERE cafe_id = $1 AND is_active = true',
      [req.cafeId]
    );
    if (countRes.rows[0].cnt >= limit) {
      const upgradeMsg = limit === 3
        ? `Free trial allows up to 3 staff accounts. Subscribe to Essential for 5, or Kitchen Pro for unlimited.`
        : `Essential plan allows up to 5 staff accounts. Upgrade to Kitchen Pro for unlimited.`;
      return fail(res, upgradeMsg, 403);
    }
  }

  const password_hash = await bcrypt.hash(password, 12);
  const result = await db.query(
    `INSERT INTO cafe_staff (cafe_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, role, is_active, created_at`,
    [req.cafeId, name, email, password_hash, staffRole]
  );
  ok(res, { staff: result.rows[0] }, 'Staff account created', 201);
});

// Owner: update a staff account (name, role, is_active)
exports.updateStaff = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, role, is_active } = req.body;

  const VALID_ROLES = ['cashier', 'kitchen', 'manager'];
  if (role && !VALID_ROLES.includes(role)) return fail(res, 'role must be cashier, kitchen, or manager');

  const result = await db.query(
    `UPDATE cafe_staff
     SET name      = COALESCE($1, name),
         role      = COALESCE($2, role),
         is_active = COALESCE($3, is_active)
     WHERE id = $4 AND cafe_id = $5
     RETURNING id, name, email, role, is_active, created_at`,
    [name || null, role || null, is_active != null ? is_active : null, id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Staff member not found', 404);
  ok(res, { staff: result.rows[0] });
});

// Owner: delete a staff account
exports.deleteStaff = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    'DELETE FROM cafe_staff WHERE id = $1 AND cafe_id = $2 RETURNING id',
    [id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Staff member not found', 404);
  ok(res, {}, 'Staff account deleted');
});
