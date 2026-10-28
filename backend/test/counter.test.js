// Counter-only payments (the default): customers can't pay online, every
// paid order leaves DineVerse's platform fee "cash_due", and the café remits
// it by UPI/bank (reported to the admin) or the admin marks it collected.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer, api, createCafe, createMenuItem, login, placeOrder, adminToken, setOnlinePayments,
} = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

async function paidCashOrder(cafe, item, owner) {
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  for (const status of ['confirmed', 'preparing', 'ready', 'served', 'paid']) {
    const r = await api(srv.base, 'PATCH', `/orders/${order.id}/status`, { token: owner, body: { status, payment_mode: 'cash' } });
    assert.equal(r.status, 200, `${status}: ${JSON.stringify(r.body)}`);
  }
  return order;
}

test('customers are never offered online payment while the switch is off', async () => {
  // Even a café whose Razorpay payout account is fully active
  const cafe = await createCafe(srv.db, { razorpay_account_id: 'acc_X', razorpay_route_enabled: true });
  const item = await createMenuItem(srv.db, cafe.id);
  const pub = await api(srv.base, 'GET', `/cafes/${cafe.slug}`);
  assert.equal(pub.body.cafe.online_payments, false);

  const order = await placeOrder(srv.base, cafe.slug, item.id);
  const pay = await api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders/${order.id}/pay`, { headers: { 'x-order-token': order.customer_token } });
  assert.equal(pay.status, 403);
  assert.match(pay.body.message, /pay at the counter/);

  const { token } = await login(srv.base, cafe.email);
  const route = await api(srv.base, 'GET', '/payments/route/status', { token });
  assert.equal(route.body.available, false);
  const connect = await api(srv.base, 'POST', '/payments/route/connect', { token, body: { legal_business_name: 'X', contact_name: 'Y' } });
  assert.equal(connect.status, 403);
});

test('the admin switch turns online payment on (and off) immediately', async () => {
  const cafe = await createCafe(srv.db, { razorpay_account_id: 'acc_X', razorpay_route_enabled: true });
  const plain = await createCafe(srv.db); // no payout account: never online
  await setOnlinePayments(srv.base, true);
  try {
    assert.equal((await api(srv.base, 'GET', `/cafes/${cafe.slug}`)).body.cafe.online_payments, true);
    assert.equal((await api(srv.base, 'GET', `/cafes/${plain.slug}`)).body.cafe.online_payments, false);
  } finally {
    await setOnlinePayments(srv.base, false);
  }
  assert.equal((await api(srv.base, 'GET', `/cafes/${cafe.slug}`)).body.cafe.online_payments, false);
});

test('counter payments leave the platform fee due; owner sees it and how to pay', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id, 'Thali', 200);
  const { token } = await login(srv.base, cafe.email);
  await paidCashOrder(cafe, item, token);
  await paidCashOrder(cafe, item, token);

  const rows = (await srv.db.query('SELECT commission_status, commission_amount::float AS c FROM orders WHERE cafe_id = $1', [cafe.id])).rows;
  assert.deepEqual(rows.map((r) => [r.commission_status, r.c]), [['cash_due', 4], ['cash_due', 4]]); // 2% of ₹200

  await api(srv.base, 'PUT', '/admin/settings/remittance', {
    token: adminToken(), body: { value: { upi_id: 'dineverse@okaxis', payee_name: 'DineVerse' } },
  });
  const summary = await api(srv.base, 'GET', '/payments/commission', { token });
  assert.equal(summary.status, 200);
  assert.equal(summary.body.cash_commission_owed, 8);
  assert.equal(summary.body.commission_rate, 2);
  assert.equal(summary.body.remit.details.upi_id, 'dineverse@okaxis');
});

test('owner reports a UPI payment; admin confirms it with the reference', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id, 'Thali', 500);
  const { token } = await login(srv.base, cafe.email);
  await paidCashOrder(cafe, item, token);
  // One order used a ₹4 DineVerse-funded discount: DineVerse owes that back
  await srv.db.query(`UPDATE orders SET platform_discount_amount = 4 WHERE cafe_id = $1`, [cafe.id]);

  const bad = await api(srv.base, 'POST', '/payments/commission/notify', { token, body: { amount: 6, reference: '' } });
  assert.equal(bad.status, 400);
  const told = await api(srv.base, 'POST', '/payments/commission/notify', { token, body: { amount: 6, reference: 'UTR123456', method: 'upi' } });
  assert.equal(told.status, 201);
  const ticket = (await srv.db.query('SELECT subject, message FROM support_tickets WHERE cafe_id = $1', [cafe.id])).rows[0];
  assert.match(ticket.subject, /Platform fee paid: ₹6\.00/);
  assert.match(ticket.message, /UTR123456/);
  assert.match(ticket.message, /Outstanding when reported: ₹6\.00/); // ₹10 fee − ₹4 credit

  const report = await api(srv.base, 'GET', '/admin/commission', { token: adminToken() });
  assert.equal(report.body.cafes.find((c) => c.id === cafe.id).cash_commission_owed, 6);

  const collect = await api(srv.base, 'POST', '/admin/commission/collect', {
    token: adminToken(), body: { cafe_id: cafe.id, payment_reference: 'UTR123456' },
  });
  assert.equal(collect.status, 200);
  assert.equal(collect.body.amount_collected, 6);
  assert.equal(collect.body.settlement.payment_reference, 'UTR123456');
  const after = await api(srv.base, 'GET', '/payments/commission', { token });
  assert.equal(after.body.cash_commission_owed, 0);
  const statuses = (await srv.db.query('SELECT DISTINCT commission_status FROM orders WHERE cafe_id = $1', [cafe.id])).rows;
  assert.deepEqual(statuses, [{ commission_status: 'collected' }]);
});

test('the API starts and serves orders with no Razorpay keys at all', async () => {
  const bare = await startServer({ RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', noStub: true });
  try {
    const cafe = await createCafe(bare.db);
    const item = await createMenuItem(bare.db, cafe.id);
    const order = await placeOrder(bare.base, cafe.slug, item.id);
    assert.ok(order.id);
    const { token } = await login(bare.base, cafe.email);
    const summary = await api(bare.base, 'GET', '/payments/commission', { token });
    assert.equal(summary.body.remit.online, false);
  } finally {
    await bare.stop();
  }
});
