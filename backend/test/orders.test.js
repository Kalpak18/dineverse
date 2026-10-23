// Customer order access (S3), server-side item names (S10), race-free kitchen
// tokens (bug #5), delivery rules (bug #6).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, createCafe, createMenuItem, placeOrder } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('customer order endpoints require the order secret', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id);
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  assert.ok(order.customer_token);
  const path = `/orders/cafe/${cafe.slug}/orders/${order.id}`;
  const right = { 'x-order-token': order.customer_token };
  const wrong = { 'x-order-token': 'deadbeef' };

  assert.equal((await api(srv.base, 'GET', `${path}/status`)).status, 404);
  assert.equal((await api(srv.base, 'GET', `${path}/status`, { headers: wrong })).status, 404);
  const ok = await api(srv.base, 'GET', `${path}/status`, { headers: right });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.order.customer_token, undefined);
  assert.equal(ok.body.order.delivery_token, undefined);

  assert.equal((await api(srv.base, 'GET', `${path}/messages`, { headers: wrong })).status, 404);
  assert.equal((await api(srv.base, 'POST', `${path}/cancel`, { headers: wrong, body: { customer_name: 'Asha' } })).status, 404);
  assert.equal((await api(srv.base, 'POST', `${path}/cancel`, { headers: right, body: {} })).status, 200);
});

test('table bill needs a token for an order at that table', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id);
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  const path = `/orders/cafe/${cafe.slug}/table-bill/3`;
  assert.equal((await api(srv.base, 'GET', `${path}?customer_name=Asha`)).status, 404);
  const r = await api(srv.base, 'GET', path, { headers: { 'x-order-tokens': `junk,${order.customer_token}` } });
  assert.equal(r.status, 200);
  assert.equal(r.body.orders.length, 1);
});

test('item names on orders come from the menu, not the client', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id, 'Tea', 20);
  const r = await api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders`, {
    body: { customer_name: 'A', table_number: '1', items: [{ menu_item_id: item.id, quantity: 1, item_name: 'FREE - owner approved' }] },
  });
  assert.equal(r.body.order.items[0].item_name, 'Tea');
});

test('concurrent orders get unique daily kitchen tokens', async () => {
  const cafe = await createCafe(srv.db);
  await Promise.all(Array.from({ length: 30 }, () => srv.db.query(
    `INSERT INTO orders (cafe_id, customer_name, table_number, total_amount, final_amount) VALUES ($1,'R','1',1,1)`, [cafe.id])));
  const r = await srv.db.query(
    'SELECT COUNT(*)::int n, COUNT(DISTINCT daily_order_number)::int d, MAX(daily_order_number) mx FROM orders WHERE cafe_id = $1', [cafe.id]);
  assert.deepEqual(r.rows[0], { n: 30, d: 30, mx: 30 });
});

test('delivery: radius, per-km fee and minimum order are enforced', async () => {
  const cafe = await createCafe(srv.db, {
    delivery_enabled: true, latitude: 18.5308, longitude: 73.8475,
    delivery_radius_km: 5, delivery_fee_base: 20, delivery_fee_per_km: 8, delivery_min_order: 150,
  });
  const item = await createMenuItem(srv.db, cafe.id, 'Thali', 200);
  const quote = (b) => api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/delivery-quote`, { body: b });

  const near = await quote({ delivery_lat: 18.5204, delivery_lng: 73.8567 });
  assert.equal(near.status, 200);
  assert.ok(near.body.delivery_fee > 20, 'per-km fee applied');
  assert.equal((await quote({ delivery_lat: 19.076, delivery_lng: 72.8777 })).status, 400); // Mumbai

  const deliver = (lat, lng, qty = 1) => api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders`, {
    body: { customer_name: 'D', order_type: 'delivery', delivery_address: 'X', delivery_phone: '9000000000',
            delivery_lat: lat, delivery_lng: lng, items: [{ menu_item_id: item.id, quantity: qty }] },
  });
  const placed = await deliver(18.5204, 73.8567);
  assert.equal(placed.status, 201);
  assert.equal(parseFloat(placed.body.order.delivery_fee), near.body.delivery_fee);
  assert.equal((await deliver(19.076, 72.8777)).status, 400);

  await srv.db.query('UPDATE menu_items SET price = 100 WHERE id = $1', [item.id]);
  const small = await deliver(18.5204, 73.8567);
  assert.equal(small.status, 400);
  assert.match(small.body.message, /Minimum order/);
});
