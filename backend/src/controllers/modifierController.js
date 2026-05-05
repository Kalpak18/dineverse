const db           = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// ─── Modifier Groups ──────────────────────────────────────────

exports.getGroups = asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.selection_type, g.is_required,
            g.min_selections, g.max_selections, g.sort_order,
            COALESCE(
              JSON_AGG(
                JSON_BUILD_OBJECT('id', o.id, 'name', o.name, 'price', o.price,
                                  'sort_order', o.sort_order, 'is_available', o.is_available)
                ORDER BY o.sort_order
              ) FILTER (WHERE o.id IS NOT NULL), '[]'
            ) AS options
     FROM modifier_groups g
     LEFT JOIN modifier_options o ON o.group_id = g.id
     WHERE g.cafe_id = $1
     GROUP BY g.id ORDER BY g.sort_order, g.name`,
    [req.cafeId]
  );
  ok(res, { groups: rows });
});

exports.createGroup = asyncHandler(async (req, res) => {
  const { name, selection_type = 'single', is_required = false,
          min_selections = 0, max_selections = 1, sort_order = 0 } = req.body;
  if (!name?.trim()) return fail(res, 'Name is required', 400);
  if (!['single', 'multiple'].includes(selection_type)) {
    return fail(res, 'Selection type must be single or multiple', 400);
  }
  const min = Math.max(0, parseInt(min_selections, 10) || 0);
  const max = Math.max(selection_type === 'single' ? 1 : min || 1, parseInt(max_selections, 10) || 1);
  if (selection_type === 'single' && max !== 1) return fail(res, 'Single choice groups can only allow one selection', 400);
  const { rows } = await db.query(
    `INSERT INTO modifier_groups (cafe_id, name, selection_type, is_required, min_selections, max_selections, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.cafeId, name.trim(), selection_type, is_required, min, max, sort_order]
  );
  ok(res, { group: { ...rows[0], options: [] } }, 'Group created');
});

exports.updateGroup = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, selection_type, is_required, min_selections, max_selections, sort_order } = req.body;
  if (selection_type && !['single', 'multiple'].includes(selection_type)) {
    return fail(res, 'Selection type must be single or multiple', 400);
  }
  const min = min_selections != null ? Math.max(0, parseInt(min_selections, 10) || 0) : null;
  const max = max_selections != null ? Math.max(1, parseInt(max_selections, 10) || 1) : null;
  if (selection_type === 'single' && max != null && max !== 1) {
    return fail(res, 'Single choice groups can only allow one selection', 400);
  }
  const { rows } = await db.query(
    `UPDATE modifier_groups SET
       name            = COALESCE($1, name),
       selection_type  = COALESCE($2, selection_type),
       is_required     = COALESCE($3, is_required),
       min_selections  = COALESCE($4, min_selections),
       max_selections  = COALESCE($5, max_selections),
       sort_order      = COALESCE($6, sort_order)
     WHERE id = $7 AND cafe_id = $8 RETURNING *`,
    [name||null, selection_type||null, is_required??null, min,
     selection_type === 'single' ? 1 : max, sort_order??null, id, req.cafeId]
  );
  if (!rows.length) return fail(res, 'Group not found', 404);
  ok(res, { group: rows[0] });
});

exports.deleteGroup = asyncHandler(async (req, res) => {
  await db.query(
    `DELETE FROM modifier_groups WHERE id = $1 AND cafe_id = $2`,
    [req.params.id, req.cafeId]
  );
  ok(res, {}, 'Group deleted');
});

// ─── Modifier Options ─────────────────────────────────────────

exports.createOption = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const { name, price = 0, sort_order = 0 } = req.body;
  if (!name?.trim()) return fail(res, 'Name is required', 400);
  const optionPrice = parseFloat(price);
  if (Number.isNaN(optionPrice) || optionPrice < 0) return fail(res, 'Price must be a positive number', 400);
  // Ensure group belongs to this cafe
  const gRes = await db.query(
    `SELECT id FROM modifier_groups WHERE id = $1 AND cafe_id = $2`, [groupId, req.cafeId]
  );
  if (!gRes.rows.length) return fail(res, 'Group not found', 404);
  const { rows } = await db.query(
    `INSERT INTO modifier_options (group_id, name, price, sort_order)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [groupId, name.trim(), optionPrice, sort_order]
  );
  ok(res, { option: rows[0] }, 'Option added');
});

exports.updateOption = asyncHandler(async (req, res) => {
  const { groupId, optionId } = req.params;
  const { name, price, sort_order, is_available } = req.body;
  const optionPrice = price != null ? parseFloat(price) : null;
  if (optionPrice != null && (Number.isNaN(optionPrice) || optionPrice < 0)) {
    return fail(res, 'Price must be a positive number', 400);
  }
  const { rows } = await db.query(
    `UPDATE modifier_options o SET
       name         = COALESCE($1, o.name),
       price        = COALESCE($2, o.price),
       sort_order   = COALESCE($3, o.sort_order),
       is_available = COALESCE($4, o.is_available)
     FROM modifier_groups g
     WHERE o.id = $5 AND o.group_id = $6 AND g.id = o.group_id AND g.cafe_id = $7
     RETURNING o.*`,
    [name||null, optionPrice, sort_order??null,
     is_available??null, optionId, groupId, req.cafeId]
  );
  if (!rows.length) return fail(res, 'Option not found', 404);
  ok(res, { option: rows[0] });
});

exports.deleteOption = asyncHandler(async (req, res) => {
  const { groupId, optionId } = req.params;
  await db.query(
    `DELETE FROM modifier_options o USING modifier_groups g
     WHERE o.id = $1 AND o.group_id = $2 AND g.id = o.group_id AND g.cafe_id = $3`,
    [optionId, groupId, req.cafeId]
  );
  ok(res, {}, 'Option deleted');
});

// ─── Link modifier groups to menu items ──────────────────────

exports.getItemGroups = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.selection_type, g.is_required,
            g.min_selections, g.max_selections, g.sort_order,
            COALESCE(
              JSON_AGG(
                JSON_BUILD_OBJECT('id', o.id, 'name', o.name, 'price', o.price,
                                  'sort_order', o.sort_order, 'is_available', o.is_available)
                ORDER BY o.sort_order
              ) FILTER (WHERE o.id IS NOT NULL), '[]'
            ) AS options
     FROM item_modifier_groups img
     JOIN modifier_groups g ON g.id = img.group_id
     LEFT JOIN modifier_options o ON o.group_id = g.id
     WHERE img.item_id = $1 AND g.cafe_id = $2
     GROUP BY g.id, img.sort_order ORDER BY img.sort_order`,
    [itemId, req.cafeId]
  );
  ok(res, { groups: rows });
});

exports.setItemGroups = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const { group_ids = [] } = req.body; // ordered array of group UUIDs
  if (!Array.isArray(group_ids)) return fail(res, 'group_ids must be an array', 400);
  const uniqueGroupIds = [...new Set(group_ids.filter(Boolean))];
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const itemCheck = await client.query(
      'SELECT id FROM menu_items WHERE id = $1 AND cafe_id = $2',
      [itemId, req.cafeId]
    );
    if (!itemCheck.rows.length) {
      await client.query('ROLLBACK');
      return fail(res, 'Item not found', 404);
    }
    if (uniqueGroupIds.length) {
      const groupCheck = await client.query(
        'SELECT id FROM modifier_groups WHERE id = ANY($1) AND cafe_id = $2',
        [uniqueGroupIds, req.cafeId]
      );
      if (groupCheck.rows.length !== uniqueGroupIds.length) {
        await client.query('ROLLBACK');
        return fail(res, 'One or more modifier groups are invalid', 400);
      }
    }
    await client.query(`DELETE FROM item_modifier_groups WHERE item_id = $1`, [itemId]);
    if (uniqueGroupIds.length) {
      const values = uniqueGroupIds.map((gid, i) => `($1, $${i + 2}, ${i})`).join(',');
      await client.query(
        `INSERT INTO item_modifier_groups (item_id, group_id, sort_order) VALUES ${values}`,
        [itemId, ...uniqueGroupIds]
      );
    }
    await client.query('COMMIT');
    ok(res, {}, 'Modifier groups updated');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// ─── Item Variants ────────────────────────────────────────────

exports.getCategoryGroups = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const categoryCheck = await db.query(
    'SELECT id FROM categories WHERE id = $1 AND cafe_id = $2',
    [categoryId, req.cafeId]
  );
  if (!categoryCheck.rows.length) return fail(res, 'Category not found', 404);

  const { rows } = await db.query(
    `SELECT g.id, g.name, g.selection_type, g.is_required,
            g.min_selections, g.max_selections, g.sort_order,
            COALESCE(
              JSON_AGG(
                JSON_BUILD_OBJECT('id', o.id, 'name', o.name, 'price', o.price,
                                  'sort_order', o.sort_order, 'is_available', o.is_available)
                ORDER BY o.sort_order
              ) FILTER (WHERE o.id IS NOT NULL), '[]'
            ) AS options
     FROM category_modifier_groups cmg
     JOIN modifier_groups g ON g.id = cmg.group_id
     LEFT JOIN modifier_options o ON o.group_id = g.id
     WHERE cmg.category_id = $1 AND g.cafe_id = $2
     GROUP BY g.id, cmg.sort_order ORDER BY cmg.sort_order`,
    [categoryId, req.cafeId]
  );
  ok(res, { groups: rows });
});

exports.setCategoryGroups = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const { group_ids = [] } = req.body;
  if (!Array.isArray(group_ids)) return fail(res, 'group_ids must be an array', 400);
  const uniqueGroupIds = [...new Set(group_ids.filter(Boolean))];
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const categoryCheck = await client.query(
      'SELECT id FROM categories WHERE id = $1 AND cafe_id = $2',
      [categoryId, req.cafeId]
    );
    if (!categoryCheck.rows.length) {
      await client.query('ROLLBACK');
      return fail(res, 'Category not found', 404);
    }
    if (uniqueGroupIds.length) {
      const groupCheck = await client.query(
        'SELECT id FROM modifier_groups WHERE id = ANY($1) AND cafe_id = $2',
        [uniqueGroupIds, req.cafeId]
      );
      if (groupCheck.rows.length !== uniqueGroupIds.length) {
        await client.query('ROLLBACK');
        return fail(res, 'One or more modifier groups are invalid', 400);
      }
    }
    await client.query('DELETE FROM category_modifier_groups WHERE category_id = $1', [categoryId]);
    if (uniqueGroupIds.length) {
      const values = uniqueGroupIds.map((gid, i) => `($1, $${i + 2}, ${i})`).join(',');
      await client.query(
        `INSERT INTO category_modifier_groups (category_id, group_id, sort_order) VALUES ${values}`,
        [categoryId, ...uniqueGroupIds]
      );
    }
    await client.query('COMMIT');
    ok(res, {}, 'Category modifier groups updated');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

exports.getVariants = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const { rows } = await db.query(
    `SELECT v.* FROM item_variants v
     JOIN menu_items m ON m.id = v.item_id
     WHERE v.item_id = $1 AND m.cafe_id = $2
     ORDER BY v.sort_order`,
    [itemId, req.cafeId]
  );
  ok(res, { variants: rows });
});

exports.saveVariants = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const { variants = [] } = req.body;
  if (!Array.isArray(variants)) return fail(res, 'variants must be an array', 400);
  // Validate item belongs to cafe
  const mRes = await db.query(`SELECT id FROM menu_items WHERE id = $1 AND cafe_id = $2`, [itemId, req.cafeId]);
  if (!mRes.rows.length) return fail(res, 'Item not found', 404);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM item_variants WHERE item_id = $1`, [itemId]);
    let saved = [];
    if (variants.length) {
      for (let i = 0; i < variants.length; i++) {
        const { name, price } = variants[i];
        if (!name?.trim() || price == null) continue;
        const variantPrice = parseFloat(price);
        if (Number.isNaN(variantPrice) || variantPrice < 0) {
          await client.query('ROLLBACK');
          return fail(res, 'Variant price must be a positive number', 400);
        }
        const { rows } = await client.query(
          `INSERT INTO item_variants (item_id, name, price, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
          [itemId, name.trim(), variantPrice, i]
        );
        saved.push(rows[0]);
      }
    }
    await client.query('COMMIT');
    ok(res, { variants: saved }, 'Variants saved');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// ─── Public: get modifiers + variants for an item (customer ordering) ──

exports.getItemModifiers = asyncHandler(async (req, res) => {
  const { slug, itemId } = req.params;

  const cafeResult = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 AND is_active = true AND setup_completed = true',
    [slug]
  );
  if (cafeResult.rows.length === 0) return fail(res, 'Café not found', 404);
  const cafeId = cafeResult.rows[0].id;

  const itemResult = await db.query(
    `SELECT id, category_id FROM menu_items WHERE id = $1 AND cafe_id = $2 AND is_available = true`,
    [itemId, cafeId]
  );
  if (itemResult.rows.length === 0) return fail(res, 'Item not found', 404);

  const [groupsRes, variantsRes] = await Promise.all([
    db.query(
      `WITH effective_groups AS (
         SELECT cmg.group_id, cmg.sort_order, 0 AS source_rank
         FROM category_modifier_groups cmg
         WHERE cmg.category_id = $2
         UNION ALL
         SELECT img.group_id, img.sort_order, 1 AS source_rank
         FROM item_modifier_groups img
         WHERE img.item_id = $1
       ),
       deduped AS (
         SELECT DISTINCT ON (group_id) group_id, sort_order, source_rank
         FROM effective_groups
         ORDER BY group_id, source_rank DESC, sort_order
       )
       SELECT g.id, g.name, g.selection_type, g.is_required,
              g.min_selections, g.max_selections, g.sort_order,
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT('id', o.id, 'name', o.name, 'price', o.price, 'sort_order', o.sort_order)
                  ORDER BY o.sort_order
                ) FILTER (WHERE o.id IS NOT NULL AND o.is_available = true), '[]'
              ) AS options
       FROM deduped d
       JOIN modifier_groups g ON g.id = d.group_id AND g.cafe_id = $3
       LEFT JOIN modifier_options o ON o.group_id = g.id
       GROUP BY g.id, d.sort_order, d.source_rank
       ORDER BY d.source_rank, d.sort_order, g.sort_order, g.name`,
      [itemId, itemResult.rows[0].category_id, cafeId]
    ),
    db.query(
      `SELECT id, name, price, sort_order FROM item_variants
       WHERE item_id = $1 AND is_available = true ORDER BY sort_order`,
      [itemId]
    ),
  ]);
  ok(res, { groups: groupsRes.rows, variants: variantsRes.rows });
});
