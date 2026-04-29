const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { ok, fail, validationFail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const cache = require('../utils/cache');

const bustMenuCache = (cafeId) => cache.del(`menu:${cafeId}`); // returns Promise — callers await it

// ─── CATEGORIES ───────────────────────────────────────────────

exports.getCategories = asyncHandler(async (req, res) => {
  const result = await db.query(
    'SELECT * FROM categories WHERE cafe_id = $1 ORDER BY display_order ASC, name ASC',
    [req.cafeId]
  );
  ok(res, { categories: result.rows });
});

exports.validateCategory = [
  body('name').trim().notEmpty().withMessage('Category name is required'),
];

exports.createCategory = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { name, display_order } = req.body;
  const result = await db.query(
    'INSERT INTO categories (cafe_id, name, display_order) VALUES ($1, $2, $3) RETURNING *',
    [req.cafeId, name, display_order || 0]
  );
  await bustMenuCache(req.cafeId);
  ok(res, { category: result.rows[0] }, 'Category created', 201);
});

exports.updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, display_order } = req.body;
  const result = await db.query(
    `UPDATE categories
     SET name = COALESCE($1, name),
         display_order = COALESCE($2, display_order)
     WHERE id = $3 AND cafe_id = $4
     RETURNING *`,
    [name, display_order, id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Category not found', 404);
  await bustMenuCache(req.cafeId);
  ok(res, { category: result.rows[0] });
});

exports.deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    'DELETE FROM categories WHERE id = $1 AND cafe_id = $2 RETURNING id',
    [id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Category not found', 404);
  await bustMenuCache(req.cafeId);
  ok(res, {}, 'Category deleted');
});

// ─── MENU ITEMS ───────────────────────────────────────────────

exports.getMenuItems = asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT mi.*, c.name AS category_name
     FROM menu_items mi
     LEFT JOIN categories c ON mi.category_id = c.id
     WHERE mi.cafe_id = $1
     ORDER BY mi.display_order ASC, mi.name ASC`,
    [req.cafeId]
  );
  ok(res, { items: result.rows });
});

exports.validateMenuItem = [
  body('name').trim().notEmpty().withMessage('Item name is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
];

exports.createMenuItem = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFail(res, errors.array());

  const { name, description, price, category_id, image_url, is_veg, is_available, display_order,
          track_stock, stock_quantity, tags } = req.body;

  if (category_id) {
    const catCheck = await db.query(
      'SELECT id FROM categories WHERE id = $1 AND cafe_id = $2',
      [category_id, req.cafeId]
    );
    if (catCheck.rows.length === 0) return fail(res, 'Invalid category');
  }

  const tagsArr = Array.isArray(tags) ? tags : [];

  const result = await db.query(
    `INSERT INTO menu_items
       (cafe_id, category_id, name, description, price, image_url, is_veg, is_available, display_order,
        track_stock, stock_quantity, tags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      req.cafeId, category_id || null, name, description || null, price,
      image_url || null,
      is_veg !== undefined ? is_veg : true,
      is_available !== undefined ? is_available : true,
      display_order || 0,
      track_stock || false,
      track_stock && stock_quantity != null ? parseInt(stock_quantity) : null,
      tagsArr,
    ]
  );
  await bustMenuCache(req.cafeId);
  ok(res, { item: result.rows[0] }, 'Menu item created', 201);
});

exports.updateMenuItem = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description, price, category_id, image_url, is_veg, is_available, display_order,
          track_stock, stock_quantity, tags } = req.body;
  const tagsArr = Array.isArray(tags) ? tags : undefined;
  const result = await db.query(
    `UPDATE menu_items
     SET name           = COALESCE($1,  name),
         description    = COALESCE($2,  description),
         price          = COALESCE($3,  price),
         category_id    = COALESCE($4,  category_id),
         image_url      = COALESCE($5,  image_url),
         is_veg         = COALESCE($6,  is_veg),
         is_available   = COALESCE($7,  is_available),
         display_order  = COALESCE($8,  display_order),
         track_stock    = COALESCE($9,  track_stock),
         stock_quantity = COALESCE($10, stock_quantity),
         tags           = COALESCE($11, tags)
     WHERE id = $12 AND cafe_id = $13
     RETURNING *`,
    [name, description, price, category_id, image_url, is_veg, is_available, display_order,
     track_stock != null ? track_stock : null,
     stock_quantity != null ? parseInt(stock_quantity) : null,
     tagsArr || null,
     id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Item not found', 404);
  await bustMenuCache(req.cafeId);
  ok(res, { item: result.rows[0] });
});

// Owner: inventory dashboard — all tracked items with stock levels
exports.getInventory = asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT mi.id, mi.name, mi.track_stock, mi.stock_quantity, mi.is_available,
            COALESCE(mi.low_stock_threshold, 5) AS low_stock_threshold,
            c.name AS category
     FROM menu_items mi
     LEFT JOIN categories c ON mi.category_id = c.id
     WHERE mi.cafe_id = $1
     ORDER BY mi.track_stock DESC, mi.stock_quantity ASC NULLS LAST, mi.name ASC`,
    [req.cafeId]
  );
  const items = result.rows.map((r) => ({
    ...r,
    low_stock: r.track_stock && r.stock_quantity != null && r.stock_quantity > 0 && r.stock_quantity <= (r.low_stock_threshold || 5),
    out_of_stock: r.track_stock && r.stock_quantity != null && r.stock_quantity <= 0,
  }));
  ok(res, { items });
});

// Owner: restock an item (set new stock quantity + optional threshold)
exports.updateStock = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { stock_quantity, track_stock, low_stock_threshold } = req.body;
  const threshold = low_stock_threshold != null ? Math.max(1, parseInt(low_stock_threshold)) : null;
  const result = await db.query(
    `UPDATE menu_items
     SET stock_quantity      = $1,
         track_stock         = COALESCE($2, track_stock),
         is_available        = CASE WHEN $1 > 0 THEN true ELSE is_available END,
         low_stock_threshold = COALESCE($5, low_stock_threshold, 5)
     WHERE id = $3 AND cafe_id = $4
     RETURNING id, name, track_stock, stock_quantity, is_available, COALESCE(low_stock_threshold, 5) AS low_stock_threshold`,
    [parseInt(stock_quantity), track_stock != null ? track_stock : null, id, req.cafeId, threshold]
  );
  if (result.rows.length === 0) return fail(res, 'Item not found', 404);
  await bustMenuCache(req.cafeId);
  ok(res, { item: result.rows[0] });
});

exports.deleteMenuItem = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    'DELETE FROM menu_items WHERE id = $1 AND cafe_id = $2 RETURNING id',
    [id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Item not found', 404);
  await bustMenuCache(req.cafeId);
  ok(res, {}, 'Item deleted');
});

exports.toggleAvailability = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    `UPDATE menu_items SET is_available = NOT is_available
     WHERE id = $1 AND cafe_id = $2
     RETURNING id, name, is_available`,
    [id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Item not found', 404);
  await bustMenuCache(req.cafeId);
  ok(res, { item: result.rows[0] });
});
