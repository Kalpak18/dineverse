// Customer order access (S3), server-side item names (S10), race-free kitchen
// tokens (bug #5), delivery rules (bug #6).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, createCafe, createMenuItem, placeOrder, login } = require('./helpers');

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
  // Placed by scanning the table QR, so it counts toward Table 3's bill
  const t3 = (await srv.db.query(`INSERT INTO cafe_tables (cafe_id, label) VALUES ($1, '3') RETURNING qr_token`, [cafe.id])).rows[0];
  const order = await placeOrder(srv.base, cafe.slug, item.id, { table_token: t3.qr_token });
  const path = `/orders/cafe/${cafe.slug}/table-bill/${encodeURIComponent('Table 3')}`;
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

test('a rush of simultaneous orders all succeed with unique token numbers', async () => {
  // Regression: createOrder held its transaction connection while offer
  // lookups borrowed a second one from the pool → >10 parallel orders
  // starved the pool and failed with "timeout exceeded when trying to connect"
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id);
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders`, {
      body: { customer_name: `G${i}`, table_number: '1', items: [{ menu_item_id: item.id, quantity: 1 }] },
    })));
  assert.deepEqual(results.map((r) => r.status).filter((s) => s !== 201), []);
  const nums = results.map((r) => Number(r.body.order.daily_order_number)).sort((a, b) => a - b);
  assert.deepEqual(nums, Array.from({ length: 30 }, (_, i) => i + 1));
});

test('order lines are capped at 100 units', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id);
  const place = (quantity) => api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders`, {
    body: { customer_name: 'X', table_number: '1', items: [{ menu_item_id: item.id, quantity }] },
  });
  assert.equal((await place(100)).status, 201);
  assert.equal((await place(101)).status, 400);
});

test('menu flags items with add-ons, and an add-on change shows up at once', async () => {
  const cafe = await createCafe(srv.db);
  const plain = await createMenuItem(srv.db, cafe.id, 'Chai', 30);
  const pizza = await createMenuItem(srv.db, cafe.id, 'Pizza', 300);
  const { token } = await login(srv.base, cafe.email);
  const menuItems = async () => {
    const r = await api(srv.base, 'GET', `/cafes/${cafe.slug}/menu`);
    const all = r.body.menu.flatMap((c) => [...c.items, ...(c.subcategories || []).flatMap((s) => s.items)]);
    return Object.fromEntries(all.map((i) => [i.name, i.has_options]));
  };
  // Uncategorised items aren't listed; give both a category
  const cat = (await srv.db.query(`INSERT INTO categories (cafe_id, name) VALUES ($1, 'Food') RETURNING id`, [cafe.id])).rows[0];
  await srv.db.query('UPDATE menu_items SET category_id = $1 WHERE cafe_id = $2', [cat.id, cafe.id]);
  assert.deepEqual(await menuItems(), { Chai: false, Pizza: false }); // also warms the menu cache

  const group = await api(srv.base, 'POST', '/modifiers/groups', { token, body: { name: 'Toppings' } });
  assert.ok(group.status < 300, JSON.stringify(group.body));
  const set = await api(srv.base, 'PUT', `/modifiers/items/${pizza.id}/groups`, { token, body: { group_ids: [group.body.group.id] } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(await menuItems(), { Chai: false, Pizza: true }); // not the cached copy
});
