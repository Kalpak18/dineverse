const db = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');

// ── Owner: submit or update their platform review ────────────────
exports.submitTestimonial = asyncHandler(async (req, res) => {
  const { rating, title, review_text, owner_name: ownerNameInput } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
  }
  if (!review_text || review_text.trim().length < 10) {
    return res.status(400).json({ success: false, message: 'Review must be at least 10 characters' });
  }
  if (review_text.trim().length > 600) {
    return res.status(400).json({ success: false, message: 'Review must be under 600 characters' });
  }

  // Pull name and location from the café record
  const cafeRes = await db.query(
    'SELECT name, city, state FROM cafes WHERE id = $1',
    [req.cafeId]
  );
  if (!cafeRes.rows.length) {
    return res.status(404).json({ success: false, message: 'Café not found' });
  }
  const { name: cafe_name, city, state } = cafeRes.rows[0];

  const owner_name = (ownerNameInput?.trim()) || cafe_name;

  const result = await db.query(
    `INSERT INTO platform_reviews
       (cafe_id, cafe_name, owner_name, city, state, rating, title, review_text, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (cafe_id) DO UPDATE SET
       rating      = EXCLUDED.rating,
       title       = EXCLUDED.title,
       review_text = EXCLUDED.review_text,
       owner_name  = EXCLUDED.owner_name,
       updated_at  = NOW()
     RETURNING *`,
    [req.cafeId, cafe_name, owner_name, city, state, rating, title?.trim() || null, review_text.trim()]
  );

  res.json({ success: true, review: result.rows[0] });
});

// ── Owner: get their own review ───────────────────────────────────
exports.getMyTestimonial = asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT * FROM platform_reviews WHERE cafe_id = $1',
    [req.cafeId]
  );
  res.json({ success: true, review: result.rows[0] || null });
});

// ── Admin: list all reviews + toggle approval ─────────────────────
exports.adminGetTestimonials = asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT pr.*, c.email AS cafe_email
     FROM platform_reviews pr
     LEFT JOIN cafes c ON c.id = pr.cafe_id
     ORDER BY pr.created_at DESC`
  );
  res.json({ success: true, reviews: result.rows });
});

exports.adminToggleApproval = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    `UPDATE platform_reviews SET is_approved = NOT is_approved WHERE id = $1 RETURNING *`,
    [id]
  );
  if (!result.rows.length) return res.status(404).json({ success: false, message: 'Review not found' });
  res.json({ success: true, review: result.rows[0] });
});

// ── Public: list approved reviews + aggregate stats ───────────────
exports.getPublicTestimonials = asyncHandler(async (req, res) => {
  const [reviewsRes, statsRes] = await Promise.all([
    db.query(
      `SELECT id, cafe_name, owner_name, city, state, rating, title, review_text, created_at
       FROM platform_reviews
       WHERE is_approved = true
       ORDER BY created_at DESC
       LIMIT 50`
    ),
    db.query(
      `SELECT
         COUNT(*)::int            AS total,
         ROUND(AVG(rating), 1)    AS avg_rating,
         COUNT(*) FILTER (WHERE rating = 5)::int AS five_star,
         COUNT(*) FILTER (WHERE rating = 4)::int AS four_star,
         COUNT(*) FILTER (WHERE rating = 3)::int AS three_star,
         COUNT(*) FILTER (WHERE rating <= 2)::int AS low_star
       FROM platform_reviews
       WHERE is_approved = true`
    ),
  ]);

  res.setHeader('Cache-Control', 'public, max-age=120'); // 2-min cache — this is landing page data
  res.json({
    success: true,
    reviews: reviewsRes.rows,
    stats:   statsRes.rows[0],
  });
});
