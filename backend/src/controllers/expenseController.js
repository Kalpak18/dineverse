const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const logger = require('../utils/logger');
const { ok, fail, validationFail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

exports.validateExpense = [
  body('name').trim().notEmpty().withMessage('Expense name is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('expense_date').optional().isDate().withMessage('Invalid date format (use YYYY-MM-DD)'),
  body('category').optional().trim().isLength({ max: 100 }),
  body('notes').optional().trim(),
];

exports.getExpenses = asyncHandler(async (req, res) => {
  const { from, to, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let where = 'WHERE cafe_id = $1';
  const params = [req.cafeId];
  let idx = 2;

  if (from) { where += ` AND expense_date >= $${idx++}`; params.push(from); }
  if (to)   { where += ` AND expense_date <= $${idx++}`; params.push(to); }

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM expenses ${where}`, params),
    db.query(
      `SELECT id, name, amount, expense_date, category, notes, created_at
       FROM expenses ${where}
       ORDER BY expense_date DESC, created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  ok(res, {
    expenses: rowsRes.rows,
    total: parseInt(countRes.rows[0].count),
    page: parseInt(page),
    limit: parseInt(limit),
  });
});

exports.createExpense = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { name, amount, expense_date, category, notes } = req.body;
  const date = expense_date || new Date().toISOString().split('T')[0];

  const result = await db.query(
    `INSERT INTO expenses (cafe_id, name, amount, expense_date, category, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, amount, expense_date, category, notes, created_at`,
    [req.cafeId, name, amount, date, category || null, notes || null]
  );
  logger.info('Expense added for cafe %s: %s ₹%s', req.cafeId, name, amount);
  ok(res, { expense: result.rows[0] }, 'Expense added', 201);
});

exports.deleteExpense = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    'DELETE FROM expenses WHERE id = $1 AND cafe_id = $2 RETURNING id',
    [id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Expense not found', 404);
  ok(res, {}, 'Expense deleted');
});
