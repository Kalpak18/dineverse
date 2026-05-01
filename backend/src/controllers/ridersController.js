const db          = require('../config/database');
const { ok, fail } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

// ─── Rider pool ───────────────────────────────────────────────

exports.getRiders = asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, name, phone, is_active, created_at
     FROM cafe_riders WHERE cafe_id = $1 ORDER BY name`,
    [req.cafeId]
  );
  ok(res, { riders: rows });
});

exports.createRider = asyncHandler(async (req, res) => {
  const { name, phone } = req.body;
  if (!name?.trim()) return fail(res, 'Name is required', 400);
  const { rows } = await db.query(
    `INSERT INTO cafe_riders (cafe_id, name, phone)
     VALUES ($1, $2, $3) RETURNING id, name, phone, is_active`,
    [req.cafeId, name.trim(), phone?.trim() || null]
  );
  ok(res, { rider: rows[0] }, 'Rider added');
});

exports.updateRider = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, phone, is_active } = req.body;
  const { rows } = await db.query(
    `UPDATE cafe_riders SET
       name      = COALESCE($1, name),
       phone     = COALESCE($2, phone),
       is_active = COALESCE($3, is_active)
     WHERE id = $4 AND cafe_id = $5
     RETURNING id, name, phone, is_active`,
    [name?.trim() || null, phone?.trim() || null, is_active ?? null, id, req.cafeId]
  );
  if (!rows.length) return fail(res, 'Rider not found', 404);
  ok(res, { rider: rows[0] }, 'Rider updated');
});

exports.deleteRider = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await db.query(
    `UPDATE cafe_riders SET is_active = false WHERE id = $1 AND cafe_id = $2`,
    [id, req.cafeId]
  );
  ok(res, {}, 'Rider removed');
});

// ─── Assign rider to order ────────────────────────────────────

exports.assignRider = asyncHandler(async (req, res) => {
  const { id: orderId } = req.params;
  const { rider_id, rider_name, rider_phone } = req.body;

  // Validate order belongs to this cafe
  const orderRes = await db.query(
    `SELECT id, delivery_status FROM orders WHERE id = $1 AND cafe_id = $2 AND order_type = 'delivery'`,
    [orderId, req.cafeId]
  );
  if (!orderRes.rows.length) return fail(res, 'Delivery order not found', 404);

  let riderName = rider_name;
  let riderPhone = rider_phone;

  // If assigning from rider pool, look up their details
  if (rider_id) {
    const riderRes = await db.query(
      `SELECT name, phone FROM cafe_riders WHERE id = $1 AND cafe_id = $2 AND is_active = true`,
      [rider_id, req.cafeId]
    );
    if (!riderRes.rows.length) return fail(res, 'Rider not found', 404);
    riderName  = riderRes.rows[0].name;
    riderPhone = riderRes.rows[0].phone;
  }

  if (!riderName?.trim()) return fail(res, 'Rider name is required', 400);

  const { rows } = await db.query(
    `UPDATE orders SET
       rider_id         = $1,
       driver_name      = $2,
       driver_phone     = $3,
       delivery_status  = 'assigned',
       delivery_partner = 'self',
       updated_at       = NOW()
     WHERE id = $4
     RETURNING id, rider_id, driver_name, driver_phone, delivery_status`,
    [rider_id || null, riderName.trim(), riderPhone?.trim() || null, orderId]
  );

  // Broadcast to customer tracking screen
  req.io?.to(`order:${orderId}`).emit('delivery_updated', {
    order_id:        orderId,
    delivery_status: 'assigned',
    driver_name:     riderName,
    driver_phone:    riderPhone || null,
  });

  // Broadcast full order update to owner room
  req.io?.to(`cafe:${req.cafeId}`).emit('order_updated', { id: orderId, ...rows[0] });

  ok(res, { order: rows[0] }, `Rider ${riderName} assigned`);
});

// ─── Owner manually updates delivery status (self-managed) ───

const SELF_STATUS_FLOW = {
  assigned:        'picked_up',
  picked_up:       'out_for_delivery',
  out_for_delivery: 'delivered',
};

exports.updateSelfDeliveryStatus = asyncHandler(async (req, res) => {
  const { id: orderId } = req.params;
  const { status } = req.body;

  const validStatuses = ['assigned', 'picked_up', 'out_for_delivery', 'delivered', 'failed'];
  if (!validStatuses.includes(status)) return fail(res, 'Invalid delivery status', 400);

  const { rows } = await db.query(
    `UPDATE orders SET
       delivery_status = $1,
       delivered_at    = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
       updated_at      = NOW()
     WHERE id = $2 AND cafe_id = $3 AND order_type = 'delivery'
     RETURNING id, delivery_status, driver_name, driver_phone, delivered_at`,
    [status, orderId, req.cafeId]
  );
  if (!rows.length) return fail(res, 'Delivery order not found', 404);

  req.io?.to(`order:${orderId}`).emit('delivery_updated', {
    order_id:        orderId,
    delivery_status: status,
    driver_name:     rows[0].driver_name,
    driver_phone:    rows[0].driver_phone,
    delivered_at:    rows[0].delivered_at,
  });
  req.io?.to(`cafe:${req.cafeId}`).emit('order_updated', { id: orderId, delivery_status: status });

  ok(res, { order: rows[0] }, 'Delivery status updated');
});

// ─── Platform config CRUD ─────────────────────────────────────

exports.getPlatforms = asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, platform, display_name, is_active,
            -- never return raw api_key; just whether it's configured
            (api_key IS NOT NULL AND api_key != '') AS has_api_key
     FROM cafe_delivery_platforms WHERE cafe_id = $1 ORDER BY platform`,
    [req.cafeId]
  );
  ok(res, { platforms: rows });
});

exports.savePlatform = asyncHandler(async (req, res) => {
  const { platform, display_name, api_key, api_secret, is_active } = req.body;
  if (!platform) return fail(res, 'platform is required', 400);

  const { rows } = await db.query(
    `INSERT INTO cafe_delivery_platforms (cafe_id, platform, display_name, api_key, api_secret, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (cafe_id, platform) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       api_key      = COALESCE(EXCLUDED.api_key, cafe_delivery_platforms.api_key),
       api_secret   = COALESCE(EXCLUDED.api_secret, cafe_delivery_platforms.api_secret),
       is_active    = EXCLUDED.is_active
     RETURNING id, platform, display_name, is_active`,
    [req.cafeId, platform, display_name || null, api_key || null, api_secret || null, is_active ?? true]
  );
  ok(res, { platform: rows[0] }, 'Platform saved');
});

exports.deletePlatform = asyncHandler(async (req, res) => {
  await db.query(
    `DELETE FROM cafe_delivery_platforms WHERE id = $1 AND cafe_id = $2`,
    [req.params.id, req.cafeId]
  );
  ok(res, {}, 'Platform removed');
});

// ─── Dispatch to third-party platform ────────────────────────

const PLATFORM_DISPATCHERS = {
  dunzo: async (order, config) => {
    const res = await fetch('https://api.dunzo.in/api/v1/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.api_key}` },
      body: JSON.stringify({
        reference_id: order.id,
        pickup_details:  { lat: order.cafe_lat,     lng: order.cafe_lng,     address: order.cafe_address },
        drop_details:    { lat: order.delivery_lat,  lng: order.delivery_lng,  address: order.delivery_address },
        request_type:    'pickup and drop',
      }),
    });
    if (!res.ok) throw new Error(`Dunzo API error: ${res.status}`);
    const data = await res.json();
    return { partner_order_id: data.task_id || data.id };
  },

  porter: async (order, config) => {
    const res = await fetch('https://papi.porter.in/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.api_key },
      body: JSON.stringify({
        request_info: { merchant_order_id: order.id, client: { name: order.cafe_name, contact_number: order.cafe_phone } },
        pickup_details: { lat: String(order.cafe_lat), lng: String(order.cafe_lng), address: { apartment_address: order.cafe_address } },
        drop_details:   { lat: String(order.delivery_lat), lng: String(order.delivery_lng), address: { apartment_address: order.delivery_address } },
      }),
    });
    if (!res.ok) throw new Error(`Porter API error: ${res.status}`);
    const data = await res.json();
    return { partner_order_id: data.order_id };
  },

  shadowfax: async (order, config) => {
    const res = await fetch('https://logistics.shadowfax.in/api/v1/order/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${config.api_key}` },
      body: JSON.stringify({
        client_order_id: order.id,
        pickup: { name: order.cafe_name, phone: order.cafe_phone, latitude: order.cafe_lat, longitude: order.cafe_lng, address: order.cafe_address },
        drop:   { name: order.customer_name, phone: order.delivery_phone, latitude: order.delivery_lat, longitude: order.delivery_lng, address: order.delivery_address },
        order_amount: parseFloat(order.final_amount),
      }),
    });
    if (!res.ok) throw new Error(`Shadowfax API error: ${res.status}`);
    const data = await res.json();
    return { partner_order_id: data.order_id || data.sf_order_id };
  },

  wefast: async (order, config) => {
    const res = await fetch('https://fleet.wefast.com/api/we-connect/v2/order/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.api_key}` },
      body: JSON.stringify({
        merchant_order_id: order.id,
        from: { address: order.cafe_address, lat: order.cafe_lat, lon: order.cafe_lng, name: order.cafe_name, phone: order.cafe_phone },
        to:   { address: order.delivery_address, lat: order.delivery_lat, lon: order.delivery_lng, name: order.customer_name, phone: order.delivery_phone },
        amount_to_collect: 0,
      }),
    });
    if (!res.ok) throw new Error(`Wefast API error: ${res.status}`);
    const data = await res.json();
    return { partner_order_id: data.order_id };
  },
};

exports.dispatchToPartform = asyncHandler(async (req, res) => {
  const { id: orderId } = req.params;
  const { platform } = req.body;
  if (!platform) return fail(res, 'platform is required', 400);

  // Fetch order + cafe details
  const orderRes = await db.query(
    `SELECT o.id, o.delivery_status, o.delivery_address, o.delivery_phone,
            o.delivery_lat, o.delivery_lng, o.final_amount, o.customer_name,
            c.latitude AS cafe_lat, c.longitude AS cafe_lng,
            c.address AS cafe_address, c.phone AS cafe_phone, c.name AS cafe_name
     FROM orders o JOIN cafes c ON o.cafe_id = c.id
     WHERE o.id = $1 AND o.cafe_id = $2 AND o.order_type = 'delivery'`,
    [orderId, req.cafeId]
  );
  if (!orderRes.rows.length) return fail(res, 'Delivery order not found', 404);
  const order = orderRes.rows[0];

  if (order.delivery_status && !['pending', null].includes(order.delivery_status)) {
    return fail(res, 'Delivery is already in progress', 409);
  }

  // Fetch platform config
  const platformRes = await db.query(
    `SELECT api_key, api_secret, display_name FROM cafe_delivery_platforms
     WHERE cafe_id = $1 AND platform = $2 AND is_active = true`,
    [req.cafeId, platform]
  );
  if (!platformRes.rows.length) return fail(res, `${platform} is not configured`, 400);
  const config = platformRes.rows[0];
  if (!config.api_key) return fail(res, `${platform} API key is not set`, 400);

  // Call the platform dispatcher
  const dispatcher = PLATFORM_DISPATCHERS[platform];
  if (!dispatcher) return fail(res, `Dispatcher for ${platform} not implemented`, 501);

  const { partner_order_id } = await dispatcher(order, config);

  // Save partner order ID and set status to pending
  const { rows } = await db.query(
    `UPDATE orders SET
       delivery_status           = 'pending',
       delivery_partner          = $1,
       delivery_partner_order_id = $2,
       updated_at                = NOW()
     WHERE id = $3
     RETURNING id, delivery_status, delivery_partner, delivery_partner_order_id`,
    [platform, partner_order_id || null, orderId]
  );

  req.io?.to(`cafe:${req.cafeId}`).emit('order_updated', { id: orderId, delivery_status: 'pending', delivery_partner: platform });

  ok(res, { order: rows[0] }, `Dispatched to ${config.display_name || platform}`);
});
