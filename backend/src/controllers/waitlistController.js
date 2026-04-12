const db           = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler  = require('../utils/asyncHandler');

// Public: customer joins waitlist
exports.joinWaitlist = asyncHandler(async (req, res) => {
  const { customer_name, customer_phone, party_size = 1, notes } = req.body;
  if (!customer_name?.trim()) return fail(res, 'Name is required', 400);

  const cafeRes = await db.query(
    'SELECT id FROM cafes WHERE slug = $1 AND is_active = true',
    [req.params.slug]
  );
  if (!cafeRes.rows.length) return fail(res, 'Café not found', 404);
  const cafeId = cafeRes.rows[0].id;

  // Count current position in queue
  const posRes = await db.query(
    'SELECT COUNT(*) AS count FROM waitlist WHERE cafe_id = $1 AND status = $2',
    [cafeId, 'waiting']
  );
  const position = parseInt(posRes.rows[0].count) + 1;

  const result = await db.query(
    `INSERT INTO waitlist (cafe_id, customer_name, customer_phone, party_size, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, customer_name, customer_phone, party_size, notes, status, created_at`,
    [cafeId, customer_name.trim(), customer_phone?.trim() || null, parseInt(party_size), notes?.trim() || null]
  );
  const entry = result.rows[0];

  // Broadcast to owner
  req.io.to(`cafe:${cafeId}`).emit('waitlist_update', { action: 'joined', entry: { ...entry, position } });

  ok(res, { entry: { ...entry, position }, queue_length: position }, 'Added to waitlist');
});

// Owner: list waitlist (active entries first)
exports.getWaitlist = asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT id, customer_name, customer_phone, party_size, notes, status, notified_at, created_at
     FROM waitlist
     WHERE cafe_id = $1
     ORDER BY
       CASE status WHEN 'waiting' THEN 0 WHEN 'seated' THEN 1 ELSE 2 END,
       created_at ASC`,
    [req.cafeId]
  );

  // Attach queue position to waiting entries
  let pos = 0;
  const rows = result.rows.map((r) => {
    if (r.status === 'waiting') pos++;
    return { ...r, position: r.status === 'waiting' ? pos : null };
  });

  ok(res, { waitlist: rows, waiting_count: pos });
});

// Owner: update waitlist entry (seat / cancel / no_show / notify)
exports.updateWaitlist = asyncHandler(async (req, res) => {
  const { status, notify } = req.body;
  const { id } = req.params;

  const allowed = ['waiting', 'seated', 'cancelled', 'no_show'];
  if (status && !allowed.includes(status)) return fail(res, 'Invalid status', 400);

  const fields = [];
  const vals   = [];
  let i = 1;

  if (status)  { fields.push(`status = $${i++}`);       vals.push(status); }
  if (notify)  { fields.push(`notified_at = NOW()`); }
  fields.push(`updated_at = NOW()`);

  if (!fields.length) return fail(res, 'Nothing to update', 400);

  vals.push(id, req.cafeId);
  const result = await db.query(
    `UPDATE waitlist SET ${fields.join(', ')}
     WHERE id = $${i++} AND cafe_id = $${i++}
     RETURNING *`,
    vals
  );
  if (!result.rows.length) return fail(res, 'Entry not found', 404);

  const entry = result.rows[0];

  // Broadcast update to owner room
  req.io.to(`cafe:${req.cafeId}`).emit('waitlist_update', { action: 'updated', entry });

  // Notify the customer socket room if they're tracking
  if (notify || status === 'seated') {
    req.io.to(`waitlist:${id}`).emit('waitlist_called', { entry });
  }

  ok(res, { entry });
});

// Owner: delete entry
exports.deleteWaitlist = asyncHandler(async (req, res) => {
  await db.query('DELETE FROM waitlist WHERE id = $1 AND cafe_id = $2', [req.params.id, req.cafeId]);
  ok(res, {});
});
