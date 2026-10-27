// Call waiter / request bill: only the order's customer can ring, repeats
// don't spam staff, only floor staff see and acknowledge requests.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, createCafe, createStaff, createMenuItem, login, placeOrder } = require('./helpers');

let srv, cafe, item, waiter, kitchen;
before(async () => {
  srv = await startServer();
  cafe = await createCafe(srv.db);
  item = await createMenuItem(srv.db, cafe.id);
  waiter = (await login(srv.base, (await createStaff(srv.db, cafe.id, 'waiter')).email)).token;
  kitchen = (await login(srv.base, (await createStaff(srv.db, cafe.id, 'kitchen')).email)).token;
});
after(async () => { await srv.stop(); });

const ring = (order, type, token = order.customer_token) =>
  api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders/${order.id}/service-request`, {
    headers: token ? { 'x-order-token': token } : {}, body: { type },
  });

test('only the customer who placed the order can call a waiter', async () => {
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  assert.equal((await ring(order, 'waiter', null)).status, 404);
  assert.equal((await ring(order, 'waiter', 'deadbeef')).status, 404);
  const r = await ring(order, 'waiter');
  assert.equal(r.status, 201);
  assert.equal(r.body.request.status, 'open');
  assert.equal(r.body.request.table_number, '3');
});

test('repeat taps do not create new requests; staff see and acknowledge', async () => {
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  const first = await ring(order, 'bill');
  const again = await ring(order, 'bill');
  assert.equal(again.status, 200);
  assert.equal(again.body.request.id, first.body.request.id);

  assert.equal((await api(srv.base, 'GET', '/orders/service-requests', { token: kitchen })).status, 403);
  const list = await api(srv.base, 'GET', '/orders/service-requests', { token: waiter });
  assert.ok(list.body.requests.some((r) => r.id === first.body.request.id));

  const ack = await api(srv.base, 'PATCH', `/orders/service-requests/${first.body.request.id}/ack`, { token: waiter });
  assert.equal(ack.body.request.status, 'acknowledged');
  assert.equal((await api(srv.base, 'PATCH', `/orders/service-requests/${first.body.request.id}/ack`, { token: waiter })).status, 404);
  // Within the cooldown, asking again returns the handled request instead of re-alerting
  assert.equal((await ring(order, 'bill')).body.request.status, 'acknowledged');
});

test('closed and non-dine-in orders cannot ring', async () => {
  const takeaway = await placeOrder(srv.base, cafe.slug, item.id, { order_type: 'takeaway', table_number: undefined });
  assert.equal((await ring(takeaway, 'waiter')).status, 400);
  const paid = await placeOrder(srv.base, cafe.slug, item.id);
  await srv.db.query(`UPDATE orders SET status = 'paid' WHERE id = $1`, [paid.id]);
  assert.equal((await ring(paid, 'waiter')).status, 400);
});
