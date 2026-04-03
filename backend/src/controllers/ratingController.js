const db = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// ─── Public: Customer submits a rating ────────────────────────
exports.submitRating = asyncHandler(async (req, res) => {
  const { slug, id: orderId } = req.params;
  const { rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) return fail(res, 'Rating must be between 1 and 5');

  // Verify order belongs to this café and is paid
  const orderResult = await db.query(
    `SELECT o.id, o.cafe_id FROM orders o
     JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND c.slug = $2 AND o.status = 'paid'`,
    [orderId, slug]
  );
  if (orderResult.rows.length === 0)
    return fail(res, 'Order not found or not yet paid', 404);

  const cafeId = orderResult.rows[0].cafe_id;

  try {
    const result = await db.query(
      `INSERT INTO order_ratings (order_id, cafe_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (order_id) DO UPDATE SET rating = $3, comment = $4
       RETURNING *`,
      [orderId, cafeId, parseInt(rating), comment?.trim() || null]
    );
    ok(res, { rating: result.rows[0] }, 'Thank you for your feedback!', 201);
  } catch (err) {
    throw err;
  }
});

// ─── Owner: get all ratings for this café ────────────────────
exports.getRatings = asyncHandler(async (req, res) => {
  const { page = 1, limit = 30 } = req.query;
  const offset = (page - 1) * limit;

  const [countRes, ratingsRes, summaryRes] = await Promise.all([
    db.query('SELECT COUNT(*) FROM order_ratings WHERE cafe_id = $1', [req.cafeId]),
    db.query(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              o.order_number,
              COALESCE(o.daily_order_number, o.order_number) AS daily_order_number,
              o.customer_name, o.table_number, o.order_type
       FROM order_ratings r
       JOIN orders o ON r.order_id = o.id
       WHERE r.cafe_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.cafeId, limit, offset]
    ),
    db.query(
      `SELECT
         ROUND(AVG(rating)::numeric, 1) AS average,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE rating = 5) AS five_star,
         COUNT(*) FILTER (WHERE rating = 4) AS four_star,
         COUNT(*) FILTER (WHERE rating = 3) AS three_star,
         COUNT(*) FILTER (WHERE rating = 2) AS two_star,
         COUNT(*) FILTER (WHERE rating = 1) AS one_star
       FROM order_ratings WHERE cafe_id = $1`,
      [req.cafeId]
    ),
  ]);

  ok(res, {
    ratings: ratingsRes.rows,
    summary: summaryRes.rows[0],
    total: parseInt(countRes.rows[0].count),
    page: parseInt(page),
  });
});
