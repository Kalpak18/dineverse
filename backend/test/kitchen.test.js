// Kitchen display plumbing (audit §3 item 8): full active-order feed, item
// statuses follow order bumps, item taps work in combined mode, prep timer
// starts from the item's default prep time.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, createCafe, createMenuItem, login, placeOrder } = require('./helpers');

let srv, cafe, owner;
before(async () => {
  srv = await startServer();
  cafe = await createCafe(srv.db);
  owner = (await login(srv.base, cafe.email)).token;
});
after(async () => { await srv.stop(); });

const bump = (id, status) => api(srv.base, 'PATCH', `/orders/${id}/status`, { token: owner, body: { status } });
const items = async (orderId) =>
  (await srv.db.query('SELECT item_status FROM order_items WHERE order_id = $1 ORDER BY id', [orderId])).rows.map((r) => r.item_status);

test('kitchen feed returns every active order with KDS item fields', async () => {
  const c = await createCafe(srv.db);
  const token = (await login(srv.base, c.email)).token;
  const item = await createMenuItem(srv.db, c.id);
  await srv.db.query('UPDATE menu_items SET is_veg = true WHERE id = $1', [item.id]);
  for (let i = 0; i < 120; i++) await placeOrder(srv.base, c.slug, item.id);
  await srv.db.query(`INSERT INTO orders (cafe_id, customer_name, table_number, total_amount, final_amount, status) VALUES ($1,'Done','1',1,1,'paid')`, [c.id]);

  const r = await api(srv.base, 'GET', '/orders/kitchen', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.orders.length, 120);
  assert.equal(r.body.orders[0].items[0].is_veg, true);
  assert.ok('default_prep_mins' in r.body.orders[0].items[0]);
});

test('order bumps move item statuses forward with the order', async () => {
  const item = await createMenuItem(srv.db, cafe.id);
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  assert.deepEqual(await items(order.id), ['pending']);
  await bump(order.id, 'confirmed');
  assert.equal((await bump(order.id, 'preparing')).status, 200);
  assert.deepEqual(await items(order.id), ['preparing']);
  await bump(order.id, 'ready');
  assert.deepEqual(await items(order.id), ['ready']);
});

test('items can be ticked in combined mode and the prep timer uses the default', async () => {
  const item = await createMenuItem(srv.db, cafe.id, 'Biryani', 250);
  await srv.db.query('UPDATE menu_items SET default_prep_mins = 18 WHERE id = $1', [item.id]);
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  const row = (await srv.db.query('SELECT kitchen_mode FROM orders WHERE id = $1', [order.id])).rows[0];
  assert.notEqual(row.kitchen_mode, 'individual');

  const itemId = order.items[0].id;
  const r = await api(srv.base, 'PATCH', `/orders/${order.id}/items/${itemId}/status`, { token: owner, body: { status: 'preparing' } });
  assert.equal(r.status, 200);
  const it = (await srv.db.query('SELECT prep_duration_mins, prep_started_at FROM order_items WHERE id = $1', [itemId])).rows[0];
  assert.equal(it.prep_duration_mins, 18);
  assert.ok(it.prep_started_at);
});

test('recall moves an order (and its items) one step back', async () => {
  const item = await createMenuItem(srv.db, cafe.id);
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  for (const s of ['confirmed', 'preparing', 'ready']) await bump(order.id, s);
  assert.deepEqual(await items(order.id), ['ready']);
  assert.equal((await bump(order.id, 'preparing')).status, 200);
  assert.deepEqual(await items(order.id), ['preparing']);
  assert.equal((await bump(order.id, 'confirmed')).status, 200);
  assert.deepEqual(await items(order.id), ['pending']);
  assert.equal((await bump(order.id, 'pending')).status, 400); // only one step, never past confirmed
});

test('items carry their category station (subcategories inherit) and the feed lists stations', async () => {
  const c = await createCafe(srv.db);
  const token = (await login(srv.base, c.email)).token;
  const drinks = await api(srv.base, 'POST', '/menu/categories', { token, body: { name: 'Drinks', station: ' Bar ' } });
  assert.equal(drinks.body.category.station, 'Bar');
  const shakes = await api(srv.base, 'POST', '/menu/categories', { token, body: { name: 'Shakes', parent_id: drinks.body.category.id } });
  const mains = await api(srv.base, 'POST', '/menu/categories', { token, body: { name: 'Mains' } });
  const shake = await srv.db.query(`INSERT INTO menu_items (cafe_id, category_id, name, price) VALUES ($1,$2,'Oreo Shake',150) RETURNING id`, [c.id, shakes.body.category.id]);
  const curry = await srv.db.query(`INSERT INTO menu_items (cafe_id, category_id, name, price) VALUES ($1,$2,'Dal',120) RETURNING id`, [c.id, mains.body.category.id]);
  await api(srv.base, 'POST', `/orders/cafe/${c.slug}/orders`, {
    body: { customer_name: 'S', table_number: '1', items: [{ menu_item_id: shake.rows[0].id, quantity: 1 }, { menu_item_id: curry.rows[0].id, quantity: 1 }] },
  });
  const feed = await api(srv.base, 'GET', '/orders/kitchen', { token });
  assert.deepEqual(feed.body.stations, ['Bar']);
  const byName = Object.fromEntries(feed.body.orders[0].items.map((i) => [i.item_name, i.station]));
  assert.deepEqual(byName, { 'Oreo Shake': 'Bar', Dal: null });

  // Clearing the station returns the category to the main kitchen
  const cleared = await api(srv.base, 'PATCH', `/menu/categories/${drinks.body.category.id}`, { token, body: { station: '' } });
  assert.equal(cleared.body.category.station, null);
});

test('a status change returns the whole order with fresh item states (no stale ticks)', async () => {
  const item = await createMenuItem(srv.db, cafe.id, 'Dosa', 90);
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  await bump(order.id, 'confirmed');
  await bump(order.id, 'preparing');
  const r = await bump(order.id, 'ready');
  assert.equal(r.status, 200);
  assert.equal(r.body.order.status, 'ready');
  assert.ok(Array.isArray(r.body.order.items), 'items included');
  assert.deepEqual(r.body.order.items.map((i) => i.item_status), ['ready']);
  assert.ok('station' in r.body.order.items[0], 'same item shape as the kitchen feed');
});

test('switching an order to individual mode keeps cooking progress', async () => {
  const a = await createMenuItem(srv.db, cafe.id, 'Idli', 60);
  const order = await placeOrder(srv.base, cafe.slug, a.id, { items: [{ menu_item_id: a.id, quantity: 1 }, { menu_item_id: a.id, quantity: 2 }] });
  await bump(order.id, 'confirmed');
  await bump(order.id, 'preparing');
  const before = await items(order.id);
  const r = await api(srv.base, 'PATCH', `/orders/${order.id}/kitchen-mode`, { token: owner, body: { mode: 'individual' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await items(order.id), before); // was reset to pending
  const accepted = (await srv.db.query('SELECT bool_and(accepted) AS ok FROM order_items WHERE order_id = $1', [order.id])).rows[0].ok;
  assert.equal(accepted, true); // already-accepted order stays accepted
});

test('many simultaneous kitchen status changes all succeed', async () => {
  // Status changes read the full order after saving — they must hand back
  // their pooled connection first or a busy kitchen starves the pool
  const item = await createMenuItem(srv.db, cafe.id, 'Vada', 40);
  const orders = await Promise.all(Array.from({ length: 30 }, () => placeOrder(srv.base, cafe.slug, item.id)));
  const results = await Promise.all(orders.map((o) => bump(o.id, 'confirmed')));
  assert.deepEqual(results.map((r) => r.status).filter((s) => s !== 200), []);
});
