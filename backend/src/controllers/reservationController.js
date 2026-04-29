const db = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');
const { notify } = require('../services/notificationService');

// ─── Public: Check if phone has a reservation today ──────────
exports.checkReservationByPhone = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { phone } = req.query;
  if (!phone?.trim()) return ok(res, { reservation: null });

  const cafeRes = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 AND is_active = true',
    [slug]
  );
  if (cafeRes.rows.length === 0) return fail(res, 'Café not found', 404);
  const cafeId = cafeRes.rows[0].id;

  const result = await db.query(
    `SELECT r.id, r.customer_name, r.customer_phone, r.party_size,
            r.reserved_date, r.reserved_time, r.status, r.notes,
            r.table_id,
            ct.label AS table_label
     FROM reservations r
     LEFT JOIN cafe_tables ct ON ct.id = r.table_id
     WHERE r.cafe_id = $1
       AND r.customer_phone = $2
       AND r.reserved_date  = CURRENT_DATE
       AND r.status IN ('pending', 'confirmed')
     ORDER BY r.reserved_time ASC
     LIMIT 1`,
    [cafeId, phone.trim()]
  );

  ok(res, { reservation: result.rows[0] || null });
});

// ─── Public: Customer books a reservation ─────────────────────
exports.createPublicReservation = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const {
    customer_name, customer_phone, party_size,
    reserved_date, reserved_time,
    area_id, table_id, notes,
    duration_minutes = 90,
  } = req.body;

  if (!customer_name?.trim()) return fail(res, 'Name is required');
  if (!reserved_date)         return fail(res, 'Date is required');
  if (!reserved_time)         return fail(res, 'Time is required');
  if (!party_size || party_size < 1) return fail(res, 'Party size must be at least 1');

  // Ensure date+time is not in the past
  const bookingDate = new Date(`${reserved_date}T${reserved_time}`);
  if (bookingDate < new Date()) return fail(res, 'Cannot book a reservation in the past');

  const cafeResult = await db.query(
    'SELECT id, email FROM cafes WHERE slug = $1 AND is_active = true',
    [slug]
  );
  if (cafeResult.rows.length === 0) return fail(res, 'Café not found', 404);
  const { id: cafeId, email: cafeEmail } = cafeResult.rows[0];

  // Validate area belongs to this café (if provided)
  if (area_id) {
    const areaCheck = await db.query(
      'SELECT id FROM areas WHERE id = $1 AND cafe_id = $2',
      [area_id, cafeId]
    );
    if (areaCheck.rows.length === 0) return fail(res, 'Invalid area');
  }

  // Check if migration 015 (table_id + duration_minutes columns) has been applied
  const colCheck = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'reservations' AND column_name = 'table_id'`
  );
  const hasMigration015 = colCheck.rows.length > 0;

  // Validate table + check for conflicts (only when migration is applied)
  if (table_id && hasMigration015) {
    const tableCheck = await db.query(
      'SELECT id FROM cafe_tables WHERE id = $1 AND cafe_id = $2 AND is_active = true',
      [table_id, cafeId]
    );
    if (tableCheck.rows.length === 0) return fail(res, 'Table not found');

    const conflict = await db.query(
      `SELECT id FROM reservations
       WHERE table_id      = $1
         AND cafe_id       = $2
         AND reserved_date = $3::DATE
         AND status        IN ('pending', 'confirmed')
         AND $4::TIME      >= reserved_time
         AND $4::TIME      <  reserved_time + (COALESCE(duration_minutes, 90) || ' minutes')::INTERVAL
         AND NOT (
           status = 'pending'
           AND ($3::DATE + reserved_time + INTERVAL '15 minutes') < NOW()
         )
       LIMIT 1`,
      [table_id, cafeId, reserved_date, reserved_time]
    );
    if (conflict.rows.length > 0) {
      return fail(res, 'This table is already reserved for that time. Please choose a different table or time.');
    }
  }

  const insertCols = hasMigration015
    ? '(cafe_id, customer_name, customer_phone, party_size, reserved_date, reserved_time, area_id, table_id, notes, duration_minutes)'
    : '(cafe_id, customer_name, customer_phone, party_size, reserved_date, reserved_time, area_id, notes)';
  const insertVals = hasMigration015
    ? [cafeId, customer_name.trim(), (customer_phone || '').trim(), party_size,
       reserved_date, reserved_time, area_id || null, table_id || null, notes || null,
       parseInt(duration_minutes) || 90]
    : [cafeId, customer_name.trim(), (customer_phone || '').trim(), party_size,
       reserved_date, reserved_time, area_id || null, notes || null];
  const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(',');

  const result = await db.query(
    `INSERT INTO reservations ${insertCols} VALUES (${placeholders}) RETURNING *`,
    insertVals
  );

  const res0 = result.rows[0];

  // Fetch joined area name + table label so the customer card can show them
  const joinedRes = await db.query(
    `SELECT r.*, a.name AS area_name, ct.label AS table_label
     FROM reservations r
     LEFT JOIN areas a ON r.area_id = a.id
     LEFT JOIN cafe_tables ct ON r.table_id = ct.id
     WHERE r.id = $1`,
    [res0.id]
  );
  const reservation = joinedRes.rows[0] || res0;

  // Notify owner — persisted so they see it even after reconnect
  const dateStr = new Date(`${reserved_date}T${reserved_time}`).toLocaleString('en-IN', {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  notify(req.io, cafeId, cafeEmail, {
    type:  'new_reservation',
    title: `New reservation from ${customer_name.trim()}`,
    body:  `${party_size} guest${party_size > 1 ? 's' : ''} · ${dateStr} — confirm or cancel`,
    refId: res0.id,
    email: true,
  }).catch(() => {});

  ok(res, { reservation }, 'Reservation requested! The café will confirm shortly.', 201);
});

// ─── Owner: list reservations (auto-expires pending past grace) ─
exports.getReservations = asyncHandler(async (req, res) => {
  const { date, status } = req.query;

  // Auto-expire: mark pending reservations where 15-min grace has passed as no_show
  await db.query(
    `UPDATE reservations
     SET status = 'no_show'
     WHERE cafe_id = $1
       AND status  = 'pending'
       AND (reserved_date + reserved_time + INTERVAL '15 minutes') < NOW()`,
    [req.cafeId]
  );

  let where = 'WHERE r.cafe_id = $1';
  const params = [req.cafeId];
  let idx = 2;
  if (date)   { where += ` AND r.reserved_date = $${idx++}`; params.push(date); }
  if (status) { where += ` AND r.status = $${idx++}`; params.push(status); }

  // Join cafe_tables only when migration 015 has added table_id column
  const colCheck2 = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'reservations' AND column_name = 'table_id'`
  );
  const tableJoin = colCheck2.rows.length > 0
    ? 'LEFT JOIN cafe_tables ct ON r.table_id = ct.id'
    : '';
  const tableLabel = colCheck2.rows.length > 0
    ? ', ct.label AS table_label'
    : ", NULL AS table_label";

  const result = await db.query(
    `SELECT r.*, a.name AS area_name ${tableLabel}
     FROM reservations r
     LEFT JOIN areas a ON r.area_id = a.id
     ${tableJoin}
     ${where}
     ORDER BY r.reserved_date ASC, r.reserved_time ASC`,
    params
  );
  ok(res, { reservations: result.rows });
});

// ─── Public: Customer polls their reservation status ──────────
exports.getPublicReservationStatus = asyncHandler(async (req, res) => {
  const { slug, id } = req.params;
  const result = await db.query(
    `SELECT r.id, r.status, r.customer_name, r.party_size,
            r.reserved_date, r.reserved_time, r.notes
     FROM reservations r
     JOIN cafes c ON r.cafe_id = c.id
     WHERE r.id = $1 AND c.slug = $2`,
    [id, slug]
  );
  if (result.rows.length === 0) return fail(res, 'Reservation not found', 404);
  ok(res, { reservation: result.rows[0] });
});

// ─── Owner: update reservation status ─────────────────────────
exports.updateReservation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  const validStatuses = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'];
  if (status && !validStatuses.includes(status)) return fail(res, 'Invalid status');

  const result = await db.query(
    `UPDATE reservations
     SET status = COALESCE($1, status),
         notes  = COALESCE($2, notes)
     WHERE id = $3 AND cafe_id = $4
     RETURNING *`,
    [status || null, notes || null, id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Reservation not found', 404);

  const joinedRes = await db.query(
    `SELECT r.*, a.name AS area_name, ct.label AS table_label
     FROM reservations r
     LEFT JOIN areas a ON r.area_id = a.id
     LEFT JOIN cafe_tables ct ON r.table_id = ct.id
     WHERE r.id = $1`,
    [result.rows[0].id]
  );
  const updated = joinedRes.rows[0] || result.rows[0];

  // Notify owner room + customer's reservation room
  if (req.io) {
    req.io.to(`cafe:${req.cafeId}`).emit('reservation_updated', updated);
    req.io.to(`reservation:${id}`).emit('reservation_updated', updated);
  }

  ok(res, { reservation: updated });
});

// ─── Owner: delete reservation ────────────────────────────────
exports.deleteReservation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    'DELETE FROM reservations WHERE id = $1 AND cafe_id = $2 RETURNING id',
    [id, req.cafeId]
  );
  if (result.rows.length === 0) return fail(res, 'Reservation not found', 404);
  ok(res, {}, 'Reservation deleted');
});
