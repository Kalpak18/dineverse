const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { ok, fail, validationFail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

exports.validateTicket = [
  body('subject').trim().notEmpty().withMessage('Subject is required').isLength({ max: 255 }),
  body('message').trim().notEmpty().withMessage('Message is required'),
];

// Owner: create a support ticket
exports.createTicket = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { subject, message } = req.body;

  const cafeRes = await db.query(
    'SELECT name, email FROM cafes WHERE id = $1',
    [req.cafeId]
  );
  const cafe = cafeRes.rows[0];

  const result = await db.query(
    `INSERT INTO support_tickets (cafe_id, cafe_name, cafe_email, subject, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, subject, message, status, created_at`,
    [req.cafeId, cafe.name, cafe.email, subject, message]
  );

  // Notify admin via socket if connected
  if (req.io) {
    req.io.to('admin_room').emit('new_ticket', result.rows[0]);
  }

  ok(res, { ticket: result.rows[0] }, 'Ticket submitted — we\'ll get back to you soon!', 201);
});

// Owner: view own tickets
exports.getMyTickets = asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT id, subject, message, status, admin_reply, replied_at, created_at, updated_at
     FROM support_tickets
     WHERE cafe_id = $1
     ORDER BY created_at DESC`,
    [req.cafeId]
  );
  ok(res, { tickets: result.rows });
});
