// Bill accuracy: what the café charges must match what the customer got.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, createCafe, createMenuItem, login } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const money = ['total_amount', 'tax_amount', 'discount_amount', 'platform_fee', 'final_amount'];
const totals = async (id) => {
  const { rows: [o] } = await srv.db.query(`SELECT ${money.join(',')} FROM orders WHERE id = $1`, [id]);
  return Object.fromEntries(money.map((k) => [k, parseFloat(o[k])]));
};
const place = async (slug, items) => {
  const r = await api(srv.base, 'POST', `/orders/cafe/${slug}/orders`, {
    body: { customer_name: 'A', table_number: '1', items: items.map((m) => ({ menu_item_id: m.id, quantity: 1 })) },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.order;
};

for (const taxInclusive of [false, true]) {
  test(`a cancelled item comes off the bill (GST ${taxInclusive ? 'included in' : 'added to'} prices)`, async () => {
    const cafe = await createCafe(srv.db, { gst_rate: 5, tax_inclusive: taxInclusive });
    const thali = await createMenuItem(srv.db, cafe.id, 'Thali', 200);
    const lassi = await createMenuItem(srv.db, cafe.id, 'Lassi', 100);
    const { token } = await login(srv.base, cafe.email);

    const both = await place(cafe.slug, [thali, lassi]);
    const lassiOnly = await place(cafe.slug, [lassi]);
    const thaliLine = (await srv.db.query('SELECT id FROM order_items WHERE order_id = $1 AND menu_item_id = $2', [both.id, thali.id])).rows[0];

    const r = await api(srv.base, 'PATCH', `/orders/${both.id}/items/${thaliLine.id}/cancel`, { token, body: { reason: 'Out of stock' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await totals(both.id), await totals(lassiOnly.id));
    assert.equal(parseFloat(r.body.order.final_amount), (await totals(lassiOnly.id)).final_amount); // screens get the new total
  });
}

test('a prepaid order keeps what was charged when an item is cancelled (refund covers it)', async () => {
  const cafe = await createCafe(srv.db);
  const a = await createMenuItem(srv.db, cafe.id, 'A', 100);
  const b = await createMenuItem(srv.db, cafe.id, 'B', 50);
  const { token } = await login(srv.base, cafe.email);
  const order = await place(cafe.slug, [a, b]);
  await srv.db.query('UPDATE orders SET payment_verified = true WHERE id = $1', [order.id]);
  const before = await totals(order.id);
  const line = (await srv.db.query('SELECT id FROM order_items WHERE order_id = $1 AND menu_item_id = $2', [order.id, b.id])).rows[0];
  await api(srv.base, 'PATCH', `/orders/${order.id}/items/${line.id}/cancel`, { token, body: { reason: 'x' } });
  assert.deepEqual(await totals(order.id), before);
});

test('a takeaway waiting in Ready can be paid at pickup (was refused, shown as collected)', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id, 'Wrap', 150);
  const { token } = await login(srv.base, cafe.email);
  const r = await api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders`, {
    body: { customer_name: 'T', order_type: 'takeaway', items: [{ menu_item_id: item.id, quantity: 1 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.order.id;
  for (const status of ['confirmed', 'preparing', 'ready']) {
    assert.equal((await api(srv.base, 'PATCH', `/orders/${id}/status`, { token, body: { status } })).status, 200);
  }
  const paid = await api(srv.base, 'PATCH', `/orders/${id}/status`, { token, body: { status: 'paid', payment_mode: 'upi' } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const { rows: [o] } = await srv.db.query('SELECT status, payment_mode, commission_status FROM orders WHERE id = $1', [id]);
  assert.deepEqual(o, { status: 'paid', payment_mode: 'upi', commission_status: 'cash_due' });
  const items = (await srv.db.query('SELECT DISTINCT item_status FROM order_items WHERE order_id = $1', [id])).rows;
  assert.deepEqual(items, [{ item_status: 'served' }]);
});
