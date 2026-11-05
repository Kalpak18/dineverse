// Counter / POS flows: staff-entered orders, paying at any time, rounds
// added after paying, refunds — the money must always add up.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, createCafe, createMenuItem, createStaff, login } = require('./helpers');

let srv, cafe, owner, thali, lassi;
before(async () => {
  srv = await startServer();
  cafe = await createCafe(srv.db);
  owner = (await login(srv.base, cafe.email)).token;
  thali = await createMenuItem(srv.db, cafe.id, 'Thali', 200);
  lassi = await createMenuItem(srv.db, cafe.id, 'Lassi', 100);
});
after(async () => { await srv.stop(); });

const row = async (id) => (await srv.db.query(
  `SELECT status, source, added_to_order_id, amount_paid::float, final_amount::float, payment_mode,
          commission_status, commission_amount::float, change_amount::float, table_number, table_verified
     FROM orders WHERE id = $1`, [id])).rows[0];
const item = (m, quantity = 1) => ({ menu_item_id: m.id, quantity });
const POST = (p, body) => api(srv.base, 'POST', p, { token: owner, body });
const PATCH = (p, body) => api(srv.base, 'PATCH', p, { token: owner, body });

test('staff take a walk-in takeaway; it pays first and keeps cooking, then is completed', async () => {
  const created = await POST('/orders/staff', { order_type: 'takeaway', items: [item(thali)] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.order.id;
  let r = await row(id);
  assert.equal(r.status, 'confirmed');          // straight to the kitchen
  assert.equal(r.source, 'staff');
  assert.equal(r.final_amount, 204);            // same pricing as a customer order (200 + 2%)

  const paid = await POST(`/orders/${id}/payment`, { payment_mode: 'cash', cash_received: 500 });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  r = await row(id);
  assert.equal(r.status, 'confirmed');          // paying first doesn't pull it from the kitchen
  assert.equal(r.amount_paid, 204);
  assert.equal(r.change_amount, 296);
  assert.equal(r.commission_status, 'cash_due');
  assert.equal(r.commission_amount, 4);

  assert.equal((await POST(`/orders/${id}/payment`, { payment_mode: 'cash' })).status, 409); // never twice

  for (const status of ['preparing', 'ready']) assert.equal((await PATCH(`/orders/${id}/status`, { status })).status, 200);
  assert.equal((await PATCH(`/orders/${id}/status`, { status: 'paid' })).status, 200);   // handed over
  r = await row(id);
  assert.equal(r.status, 'paid');
  assert.equal(r.amount_paid, 204);             // not charged again
});

test('paying an order that is already ready closes it in one step', async () => {
  const { body } = await POST('/orders/staff', { order_type: 'takeaway', items: [item(lassi)] });
  const id = body.order.id;
  for (const status of ['preparing', 'ready']) await PATCH(`/orders/${id}/status`, { status });
  const paid = await POST(`/orders/${id}/payment`, { payment_mode: 'upi' });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.order.status, 'paid');
  assert.deepEqual(paid.body.order.items.map((i) => i.item_status), ['served']);
});

test('items added after paying become a new round that is due on its own', async () => {
  const { body } = await POST('/orders/staff', { order_type: 'takeaway', customer_name: 'Ravi', items: [item(thali)] });
  const first = body.order.id;
  await POST(`/orders/${first}/payment`, { payment_mode: 'cash' });

  const added = await POST(`/orders/${first}/add-items`, { items: [item(lassi, 2)] });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const round = await row(added.body.order.id);
  assert.equal(round.added_to_order_id, first);
  assert.equal(round.status, 'confirmed');        // new KOT for the kitchen
  assert.equal(round.amount_paid, 0);
  assert.equal(round.final_amount, 204);          // 2 × 100 + 2%
  const original = await row(first);
  assert.equal(original.final_amount, 204);       // the paid order is untouched
  assert.equal(original.amount_paid, 204);

  // A round of a round still points at the first order
  const again = await POST(`/orders/${added.body.order.id}/add-items`, { items: [item(lassi)] });
  assert.equal((await row(again.body.order.id)).added_to_order_id, first);
});

test('dine-in staff order goes on the chosen table, confirmed', async () => {
  const { rows: [t] } = await srv.db.query(`INSERT INTO cafe_tables (cafe_id, label) VALUES ($1, '7') RETURNING id`, [cafe.id]);
  const r = await POST('/orders/staff', { order_type: 'dine-in', table_id: t.id, items: [item(thali)] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const saved = await row(r.body.order.id);
  assert.equal(saved.table_verified, true);
  assert.match(saved.table_number, /7/);
  assert.equal((await POST('/orders/staff', { order_type: 'dine-in', items: [item(thali)] })).status, 400); // needs a table
});

test('an item cancelled after paying shows a refund owed, then recorded', async () => {
  const { body } = await POST('/orders/staff', { order_type: 'takeaway', items: [item(thali), item(lassi)] });
  const id = body.order.id;
  await POST(`/orders/${id}/payment`, { payment_mode: 'cash' });
  assert.equal((await row(id)).amount_paid, 306);
  const lassiLine = body.order.items.find((i) => i.menu_item_id === lassi.id);
  assert.equal((await PATCH(`/orders/${id}/items/${lassiLine.id}/cancel`, { reason: 'Out of curd' })).status, 200);
  let r = await row(id);
  assert.equal(r.final_amount, 204);              // re-priced
  assert.equal(r.amount_paid - r.final_amount, 102); // refund owed

  assert.equal((await POST(`/orders/${id}/cash-refund`)).status, 200);
  r = await row(id);
  assert.equal(r.amount_paid, 204);
  assert.equal((await POST(`/orders/${id}/cash-refund`)).status, 409); // nothing more owed
});

test('a paid order that is cancelled owes a full refund and no platform fee', async () => {
  const { body } = await POST('/orders/staff', { order_type: 'takeaway', items: [item(thali)] });
  const id = body.order.id;
  await POST(`/orders/${id}/payment`, { payment_mode: 'card' });
  assert.equal((await PATCH(`/orders/${id}/status`, { status: 'cancelled', cancellation_reason: 'Customer left' })).status, 200);
  let r = await row(id);
  assert.equal(r.commission_status, 'pending'); // not owed
  assert.equal(r.commission_amount, 0);
  assert.equal(r.amount_paid, 204);
  assert.equal((await POST(`/orders/${id}/cash-refund`)).status, 200);
  r = await row(id);
  assert.equal(r.amount_paid, 0);
});

test('waiters can take orders but not money', async () => {
  const waiter = await createStaff(srv.db, cafe.id, 'waiter');
  const { token } = await login(srv.base, waiter.email);
  const r = await api(srv.base, 'POST', '/orders/staff', { token, body: { order_type: 'takeaway', items: [item(lassi)] } });
  assert.equal(r.status, 201);
  assert.equal((await api(srv.base, 'POST', `/orders/${r.body.order.id}/payment`, { token, body: { payment_mode: 'cash' } })).status, 403);
});
