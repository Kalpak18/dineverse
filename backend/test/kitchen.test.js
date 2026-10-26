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
