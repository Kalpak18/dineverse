const db = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// ─── GET /api/tables/areas ────────────────────────────────────
// Owner: get all areas + their tables
exports.getAreas = asyncHandler(async (req, res) => {
  const [areasRes, tablesRes] = await Promise.all([
    db.query(
      'SELECT id, name, sort_order, is_active FROM areas WHERE cafe_id = $1 ORDER BY sort_order ASC, name ASC',
      [req.cafeId]
    ),
    db.query(
      'SELECT id, area_id, label, is_active FROM cafe_tables WHERE cafe_id = $1 ORDER BY label ASC',
      [req.cafeId]
    ),
  ]);

  const areas = areasRes.rows.map((a) => ({
    ...a,
    tables: tablesRes.rows.filter((t) => t.area_id === a.id),
  }));
  // Tables not assigned to any area
  const unassigned = tablesRes.rows.filter((t) => !t.area_id);

  ok(res, { areas, unassigned });
});

// ─── POST /api/tables/areas ───────────────────────────────────
exports.createArea = asyncHandler(async (req, res) => {
  const { name, sort_order = 0 } = req.body;
  if (!name || !name.trim()) return fail(res, 'Area name is required');

  const result = await db.query(
    'INSERT INTO areas (cafe_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id, name, sort_order, is_active',
    [req.cafeId, name.trim(), parseInt(sort_order)]
  );
  ok(res, { area: { ...result.rows[0], tables: [] } }, 'Area created', 201);
});

// ─── PATCH /api/tables/areas/:id ─────────────────────────────
exports.updateArea = asyncHandler(async (req, res) => {
  const { name, sort_order, is_active } = req.body;
  const result = await db.query(
    `UPDATE areas
     SET name       = COALESCE($1, name),
         sort_order = COALESCE($2, sort_order),
         is_active  = COALESCE($3, is_active)
     WHERE id = $4 AND cafe_id = $5
     RETURNING id, name, sort_order, is_active`,
    [name?.trim() || null, sort_order != null ? parseInt(sort_order) : null, is_active ?? null, req.params.id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Area not found', 404);
  ok(res, { area: result.rows[0] });
});

// ─── DELETE /api/tables/areas/:id ────────────────────────────
exports.deleteArea = asyncHandler(async (req, res) => {
  // Unassign tables before deleting area
  await db.query('UPDATE cafe_tables SET area_id = NULL WHERE area_id = $1 AND cafe_id = $2', [req.params.id, req.cafeId]);
  const result = await db.query('DELETE FROM areas WHERE id = $1 AND cafe_id = $2', [req.params.id, req.cafeId]);
  if (result.rowCount === 0) return fail(res, 'Area not found', 404);
  ok(res, {}, 'Area deleted');
});

// ─── POST /api/tables ─────────────────────────────────────────
exports.createTable = asyncHandler(async (req, res) => {
  const { label, area_id } = req.body;
  if (!label || !label.trim()) return fail(res, 'Table label is required');

  // Verify area belongs to this cafe (if provided)
  if (area_id) {
    const areaCheck = await db.query('SELECT id FROM areas WHERE id = $1 AND cafe_id = $2', [area_id, req.cafeId]);
    if (areaCheck.rows.length === 0) return fail(res, 'Area not found', 404);
  }

  const result = await db.query(
    'INSERT INTO cafe_tables (cafe_id, area_id, label) VALUES ($1, $2, $3) RETURNING id, area_id, label, is_active',
    [req.cafeId, area_id || null, label.trim()]
  );
  ok(res, { table: result.rows[0] }, 'Table created', 201);
});

// ─── PATCH /api/tables/:id ────────────────────────────────────
exports.updateTable = asyncHandler(async (req, res) => {
  const { label, area_id, is_active } = req.body;
  const result = await db.query(
    `UPDATE cafe_tables
     SET label     = COALESCE($1, label),
         area_id   = COALESCE($2, area_id),
         is_active = COALESCE($3, is_active)
     WHERE id = $4 AND cafe_id = $5
     RETURNING id, area_id, label, is_active`,
    [label?.trim() || null, area_id !== undefined ? area_id : null, is_active ?? null, req.params.id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Table not found', 404);
  ok(res, { table: result.rows[0] });
});

// ─── DELETE /api/tables/:id ───────────────────────────────────
exports.deleteTable = asyncHandler(async (req, res) => {
  const result = await db.query('DELETE FROM cafe_tables WHERE id = $1 AND cafe_id = $2', [req.params.id, req.cafeId]);
  if (result.rowCount === 0) return fail(res, 'Table not found', 404);
  ok(res, {}, 'Table deleted');
});

// ─── Owner: GET /api/tables/live ──────────────────────────────
// Returns every table with:
//   active_orders: [{id, order_number, customer_name, status, final_amount, item_count, created_at}]
//   reservations:  [{id, customer_name, party_size, reserved_date, reserved_time, status}]  (today + future, next 24h)
//   is_occupied:   bool  (has at least one non-paid, non-cancelled order)
exports.getLiveTables = asyncHandler(async (req, res) => {
  const [areasRes, tablesRes, ordersRes, resvRes] = await Promise.all([
    db.query(
      'SELECT id, name, sort_order FROM areas WHERE cafe_id = $1 AND is_active = true ORDER BY sort_order ASC, name ASC',
      [req.cafeId]
    ),
    db.query(
      'SELECT id, area_id, label FROM cafe_tables WHERE cafe_id = $1 AND is_active = true ORDER BY label ASC',
      [req.cafeId]
    ),
    // Active dine-in orders grouped by table_number (pending / confirmed / preparing / ready / served)
    db.query(
      `SELECT
         o.id, o.table_number, o.customer_name, o.status,
         o.final_amount, o.daily_order_number, o.order_number,
         o.created_at,
         COUNT(oi.id)::int AS item_count
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.cafe_id = $1
         AND o.order_type = 'dine-in'
         AND o.status NOT IN ('paid', 'cancelled')
       GROUP BY o.id
       ORDER BY o.created_at ASC`,
      [req.cafeId]
    ),
    // Reservations for today + next 24 h (pending + confirmed only)
    db.query(
      `SELECT id, customer_name, customer_phone, party_size,
              reserved_date, reserved_time, status, notes,
              COALESCE(table_id::text, '') AS table_id,
              COALESCE(area_id::text, '') AS area_id
       FROM reservations
       WHERE cafe_id = $1
         AND status IN ('pending', 'confirmed', 'seated')
         AND reserved_date >= CURRENT_DATE
         AND (reserved_date < CURRENT_DATE + INTERVAL '1 day'
              OR (reserved_date = CURRENT_DATE + INTERVAL '1 day'
                  AND reserved_time <= (CURRENT_TIME + INTERVAL '2 hours')))
       ORDER BY reserved_date ASC, reserved_time ASC`,
      [req.cafeId]
    ),
  ]);

  // Index orders by normalised table label
  const ordersByTable = {};
  for (const o of ordersRes.rows) {
    const key = (o.table_number || '').toLowerCase().trim();
    if (!ordersByTable[key]) ordersByTable[key] = [];
    ordersByTable[key].push(o);
  }

  // Index reservations by table_id (if linked) and fall back to label matching
  const resvByTableId = {};
  const resvUnlinked  = [];
  for (const r of resvRes.rows) {
    if (r.table_id) {
      if (!resvByTableId[r.table_id]) resvByTableId[r.table_id] = [];
      resvByTableId[r.table_id].push(r);
    } else {
      resvUnlinked.push(r);
    }
  }

  const tables = tablesRes.rows.map((t) => {
    const key    = t.label.toLowerCase().trim();
    const orders = ordersByTable[key] || [];
    const resv   = (resvByTableId[String(t.id)] || []);
    return {
      id:          t.id,
      area_id:     t.area_id,
      label:       t.label,
      is_occupied: orders.length > 0,
      active_orders: orders,
      reservations:  resv,
    };
  });

  const areas = areasRes.rows.map((a) => ({
    ...a,
    tables: tables.filter((t) => t.area_id === a.id),
  }));
  const unassigned = tables.filter((t) => !t.area_id);

  // Summary counts
  const totalTables   = tables.length;
  const occupiedCount = tables.filter((t) => t.is_occupied).length;

  ok(res, { areas, unassigned, total_tables: totalTables, occupied_count: occupiedCount });
});

// ─── Public: GET /api/cafes/:slug/tables?date=&time= ──────────
// Returns active areas + their active tables.
// If ?date=YYYY-MM-DD&time=HH:MM are provided, each table gets:
//   is_reserved: bool   — blocked by an active reservation at that moment
//   reserved_until: "HH:MM" | null   — when the table becomes free
// A pending reservation auto-expires 15 min after reserved_time.
// A confirmed reservation holds for its full duration_minutes.
exports.getPublicTables = asyncHandler(async (req, res) => {
  const cafeRes = await db.query('SELECT id FROM cafes WHERE slug = $1 AND is_active = true', [req.params.slug]);
  if (cafeRes.rows.length === 0) return fail(res, 'Café not found', 404);
  const cafeId = cafeRes.rows[0].id;

  const { date, time } = req.query;
  const checkAvailability = date && time;

  const areasRes = await db.query(
    'SELECT id, name, sort_order FROM areas WHERE cafe_id = $1 AND is_active = true ORDER BY sort_order ASC, name ASC',
    [cafeId]
  );

  let tablesRows;
  if (checkAvailability) {
    // First check if migration 015 has been applied (table_id + duration_minutes exist)
    const colCheck = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'reservations' AND column_name = 'table_id'`
    );
    const migrationApplied = colCheck.rows.length > 0;

    if (migrationApplied) {
      const result = await db.query(
        `SELECT ct.id, ct.area_id, ct.label,
                r.id AS res_id,
                TO_CHAR(
                  r.reserved_time + (COALESCE(r.duration_minutes, 90) || ' minutes')::INTERVAL,
                  'HH24:MI'
                ) AS reserved_until
         FROM cafe_tables ct
         LEFT JOIN LATERAL (
           SELECT id, reserved_time, reserved_date, duration_minutes, status
           FROM reservations
           WHERE table_id = ct.id
             AND cafe_id  = $1
             AND reserved_date = $2::DATE
             AND status IN ('pending', 'confirmed')
             AND $3::TIME < reserved_time + (COALESCE(duration_minutes, 90) || ' minutes')::INTERVAL
             AND $3::TIME + INTERVAL '90 minutes' > reserved_time
             AND NOT (
               status = 'pending'
               AND $3::TIME > reserved_time + INTERVAL '15 minutes'
             )
           LIMIT 1
         ) r ON true
         WHERE ct.cafe_id = $1 AND ct.is_active = true
         ORDER BY ct.label ASC`,
        [cafeId, date, time]
      );
      tablesRows = result.rows.map((t) => ({
        id:             t.id,
        area_id:        t.area_id,
        label:          t.label,
        is_reserved:    !!t.res_id,
        reserved_until: t.reserved_until || null,
      }));
    } else {
      // Migration not yet applied — return tables without availability info
      const result = await db.query(
        'SELECT id, area_id, label FROM cafe_tables WHERE cafe_id = $1 AND is_active = true ORDER BY label ASC',
        [cafeId]
      );
      tablesRows = result.rows.map((t) => ({ ...t, is_reserved: false, reserved_until: null }));
    }
  } else {
    const result = await db.query(
      'SELECT id, area_id, label FROM cafe_tables WHERE cafe_id = $1 AND is_active = true ORDER BY label ASC',
      [cafeId]
    );
    tablesRows = result.rows.map((t) => ({ ...t, is_reserved: false, reserved_until: null }));
  }

  const areas = areasRes.rows.map((a) => ({
    ...a,
    tables: tablesRows.filter((t) => t.area_id === a.id),
  }));

  // Tables not assigned to any area — put them in a virtual "General" group
  const unassigned = tablesRows.filter((t) => !t.area_id);
  if (unassigned.length > 0) {
    areas.push({ id: null, name: 'General', sort_order: 999, tables: unassigned });
  }

  ok(res, { areas, has_tables: tablesRows.length > 0 });
});
