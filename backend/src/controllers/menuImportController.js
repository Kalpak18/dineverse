const db = require('../config/database');
const logger = require('../utils/logger');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const { cleanTranslations } = require('../utils/translations');
const cache = require('../utils/cache');

const MAX_ROWS = 500;
const VEG = new Set(['veg', 'v', 'yes', 'y', 'true', '1', 'vegetarian']);
const NON_VEG = new Set(['non-veg', 'nonveg', 'non veg', 'nv', 'no', 'n', 'false', '0', 'non-vegetarian']);

function parseRow(raw, i) {
  const row = i + 2; // spreadsheet row number (header is row 1)
  const name = String(raw.name ?? '').trim();
  const price = Number(String(raw.price ?? '').replace(/[₹,\s]/g, ''));
  const vegRaw = String(raw.is_veg ?? raw.veg ?? '').trim().toLowerCase();
  const errors = [];
  if (!name) errors.push('name is required');
  if (name.length > 150) errors.push('name is longer than 150 characters');
  if (!Number.isFinite(price) || price < 0) errors.push(`price "${raw.price ?? ''}" is not a valid amount`);
  if (vegRaw && !VEG.has(vegRaw) && !NON_VEG.has(vegRaw)) errors.push(`veg "${raw.is_veg ?? raw.veg}" should be veg or non-veg`);
  return {
    row, errors,
    item: {
      name,
      price: Math.round(price * 100) / 100,
      category: String(raw.category ?? '').trim().slice(0, 100) || null,
      description: String(raw.description ?? '').trim().slice(0, 1000) || null,
      is_veg: vegRaw ? VEG.has(vegRaw) : true,
      tags: String(raw.tags ?? '').split(/[;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10),
      translations: cleanTranslations({
        hi: { name: raw.hi_name, description: raw.hi_description },
        mr: { name: raw.mr_name, description: raw.mr_description },
      }),
    },
  };
}

// ─── POST /api/menu/import ─────────────────────────────────────
// body: { rows: [{ name, price, category, description, is_veg, tags,
//                  hi_name, hi_description, mr_name, mr_description }] }
// All-or-nothing: any invalid row → nothing saved, every problem listed.
// An existing item with the same name in the same category is updated
// (price, description, veg, tags, translations) instead of duplicated.
exports.importMenu = asyncHandler(async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) return fail(res, 'No rows to import', 400);
  if (rows.length > MAX_ROWS) return fail(res, `At most ${MAX_ROWS} rows per import`, 400);

  const parsed = rows.map((r, i) => parseRow(r || {}, i));
  const errors = parsed.flatMap((p) => p.errors.map((message) => ({ row: p.row, message })));
  if (errors.length) return res.status(400).json({ success: false, message: 'Fix these rows and import again', errors });

  const client = await db.pool.connect();
  let created = 0, updated = 0, categoriesCreated = 0;
  try {
    await client.query('BEGIN');
    const cats = await client.query('SELECT id, name FROM categories WHERE cafe_id = $1 AND parent_id IS NULL', [req.cafeId]);
    const catByName = new Map(cats.rows.map((c) => [c.name.trim().toLowerCase(), c.id]));

    for (const { item } of parsed) {
      let categoryId = null;
      if (item.category) {
        const key = item.category.toLowerCase();
        categoryId = catByName.get(key);
        if (!categoryId) {
          const c = await client.query('INSERT INTO categories (cafe_id, name) VALUES ($1, $2) RETURNING id', [req.cafeId, item.category]);
          categoryId = c.rows[0].id;
          catByName.set(key, categoryId);
          categoriesCreated += 1;
        }
      }
      const existing = await client.query(
        `SELECT id FROM menu_items
         WHERE cafe_id = $1 AND LOWER(name) = LOWER($2) AND category_id IS NOT DISTINCT FROM $3
         LIMIT 1`,
        [req.cafeId, item.name, categoryId]
      );
      const tr = JSON.stringify(item.translations || {});
      if (existing.rows.length) {
        await client.query(
          `UPDATE menu_items SET price = $1, description = COALESCE($2, description), is_veg = $3,
             tags = CASE WHEN cardinality($4::text[]) > 0 THEN $4::text[] ELSE tags END,
             translations = translations || $5::jsonb
           WHERE id = $6`,
          [item.price, item.description, item.is_veg, item.tags, tr, existing.rows[0].id]
        );
        updated += 1;
      } else {
        await client.query(
          `INSERT INTO menu_items (cafe_id, category_id, name, description, price, is_veg, tags, translations)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [req.cafeId, categoryId, item.name, item.description, item.price, item.is_veg, item.tags, tr]
        );
        created += 1;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await cache.del(`menu:${req.cafeId}`);
  logger.info('Menu import for café %s: %d created, %d updated, %d categories', req.cafeId, created, updated, categoriesCreated);
  ok(res, { created, updated, categories_created: categoriesCreated },
    `Imported ${created + updated} item${created + updated === 1 ? '' : 's'}`);
});
