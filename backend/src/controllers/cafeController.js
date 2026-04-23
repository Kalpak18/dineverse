const db = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const cache = require('../utils/cache');

// Public: get café by slug (for customer-facing pages)
exports.getCafeBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const cacheKey = `cafe:${slug}`;
  const cached = cache.get(cacheKey);
  if (cached) return ok(res, { cafe: cached });

  const result = await db.query(
    `SELECT id, name, slug, description, address, phone, logo_url, cover_image_url,
            name_style, latitude, longitude, city, is_open,
            gst_rate, gst_number, fssai_number,
            COALESCE(tax_inclusive, false) AS tax_inclusive,
            COALESCE(business_type, 'restaurant') AS business_type,
            COALESCE(country, 'India') AS country,
            COALESCE(currency, 'INR') AS currency,
            opening_hours,
            COALESCE(timezone, 'Asia/Kolkata') AS timezone
     FROM cafes WHERE slug = $1 AND is_active = true AND setup_completed = true`,
    [slug]
  );
  if (result.rows.length === 0) return fail(res, 'Café not found', 404);
  cache.set(cacheKey, result.rows[0], 60_000);
  ok(res, { cafe: result.rows[0] });
});

// Public: explore cafés by city
exports.exploreCafes = asyncHandler(async (req, res) => {
  const { city } = req.query;
  let whereClause = `WHERE c.is_active = true AND c.setup_completed = true AND c.plan_expiry_date > NOW()`;
  const params = [];
  if (city && city.trim()) {
    params.push(`%${city.trim()}%`);
    whereClause += ` AND c.city ILIKE $1`;
  }
  const result = await db.query(
    `SELECT c.id, c.name, c.slug, c.description, c.city, c.address,
            c.logo_url, c.cover_image_url, c.latitude, c.longitude
     FROM cafes c
     ${whereClause}
     ORDER BY c.name ASC
     LIMIT 50`,
    params
  );
  ok(res, { cafes: result.rows });
});

// Public: get cafés near a lat/lng point, sorted by distance
exports.getNearbyCafes = asyncHandler(async (req, res) => {
  const lat    = parseFloat(req.query.lat);
  const lng    = parseFloat(req.query.lng);
  const radius = Math.min(500, Math.max(0.5, parseFloat(req.query.radius) || 30));

  if (isNaN(lat) || isNaN(lng)) return fail(res, 'lat and lng are required', 400);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return fail(res, 'Invalid coordinates', 400);

  const result = await db.query(`
    WITH dist AS (
      SELECT c.id, c.name, c.slug, c.description, c.city, c.address,
             c.logo_url, c.cover_image_url, c.latitude, c.longitude,
             6371 * acos(LEAST(1.0,
               cos(radians($1)) * cos(radians(c.latitude))
                 * cos(radians(c.longitude) - radians($2))
               + sin(radians($1)) * sin(radians(c.latitude))
             )) AS distance_km
      FROM cafes c
      WHERE c.is_active = true AND c.setup_completed = true AND c.plan_expiry_date > NOW()
        AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
    )
    SELECT * FROM dist WHERE distance_km <= $3 ORDER BY distance_km ASC LIMIT 100
  `, [lat, lng, radius]);

  ok(res, { cafes: result.rows });
});

// Public: get available tables for a café (no active orders on them)
exports.getAvailableTables = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const cafeResult = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 AND is_active = true AND setup_completed = true',
    [slug]
  );
  if (cafeResult.rows.length === 0) return fail(res, 'Café not found', 404);
  const cafeId = cafeResult.rows[0].id;

  // Tables that have no order currently in pending/confirmed/preparing/ready/served
  const result = await db.query(
    `SELECT t.id, t.label, a.name AS area_name,
            NOT EXISTS (
              SELECT 1 FROM orders o
              WHERE o.cafe_id = $1
                AND o.table_number = CONCAT(a.name, ' — ', t.label)
                AND o.status IN ('pending','confirmed','preparing','ready','served')
            ) AS is_available
     FROM cafe_tables t
     LEFT JOIN areas a ON t.area_id = a.id
     WHERE t.cafe_id = $1 AND t.is_active = true
     ORDER BY a.name NULLS LAST, t.label`,
    [cafeId]
  );
  ok(res, { tables: result.rows });
});

// Public: get café menu (categories + items) by slug
exports.getCafeMenu = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const cafeResult = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 AND is_active = true AND setup_completed = true',
    [slug]
  );
  if (cafeResult.rows.length === 0) return fail(res, 'Café not found', 404);

  const cafeId = cafeResult.rows[0].id;
  const cacheKey = `menu:${cafeId}`;
  const cached = cache.get(cacheKey);
  if (cached) return ok(res, { menu: cached });

  const [categoriesResult, itemsResult] = await Promise.all([
    db.query(
      `SELECT id, name, display_order FROM categories
       WHERE cafe_id = $1
       ORDER BY display_order ASC, name ASC`,
      [cafeId]
    ),
    db.query(
      `SELECT id, category_id, name, description, price, image_url, is_veg, is_available, display_order
       FROM menu_items
       WHERE cafe_id = $1 AND is_available = true
       ORDER BY display_order ASC, name ASC`,
      [cafeId]
    ),
  ]);

  const menu = categoriesResult.rows.map((cat) => ({
    ...cat,
    items: itemsResult.rows.filter((item) => item.category_id === cat.id),
  }));

  const uncategorized = itemsResult.rows.filter((item) => !item.category_id);
  if (uncategorized.length > 0) {
    menu.push({ id: null, name: 'Other', display_order: 999, items: uncategorized });
  }

  cache.set(cacheKey, menu, 30_000);
  ok(res, { menu });
});

// Owner: toggle café open/closed
exports.toggleCafeOpen = asyncHandler(async (req, res) => {
  const result = await db.query(
    'UPDATE cafes SET is_open = NOT is_open WHERE id = $1 RETURNING is_open, slug',
    [req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Café not found', 404);
  const { is_open, slug } = result.rows[0];
  cache.del(`cafe:${slug}`);
  // Broadcast live status to all customers on this café's menu/cart pages
  req.io.to(`menu:${slug}`).emit('cafe_status', { is_open });
  ok(res, { is_open });
});
