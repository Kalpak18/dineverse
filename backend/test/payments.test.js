// Money paths against the fake Razorpay: commission status + no double
// payout + loyalty once (bugs #1, #2), refunds (bug #4), commission settlement
// only from real commission orders (S6).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  startServer, api, createCafe, createMenuItem, login, placeOrder, payOrder, sleep,
  RZP_SECRET, RZP_WEBHOOK_SECRET,
} = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const routeCafe = () => createCafe(srv.db, { razorpay_account_id: 'acc_X', razorpay_route_enabled: true });
const orderRow = async (id) => (await srv.db.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
const markPaid = (token, id, body = {}) => api(srv.base, 'PATCH', `/orders/${id}/status`, { token, body: { status: 'paid', ...body } });

test('prepaid order: commission auto_deducted, Route transfer recorded, no manual transfer, loyalty once', async () => {
  const cafe = await routeCafe();
  const item = await createMenuItem(srv.db, cafe.id);
  await srv.db.query('INSERT INTO loyalty_programs (cafe_id, points_per_rupee, is_active) VALUES ($1, 1, true)', [cafe.id]);
  const owner = await login(srv.base, cafe.email);
  const order = await placeOrder(srv.base, cafe.slug, item.id, { customer_phone: '9000000001' });

  assert.equal((await payOrder(srv.base, cafe.slug, order)).status, 200);
  assert.equal((await markPaid(owner.token, order.id)).status, 200);
  await sleep(500); // post-paid hooks are fire-and-forget

  const row = await orderRow(order.id);
  assert.equal(row.commission_status, 'auto_deducted');
  assert.ok(row.razorpay_transfer_id);
  assert.equal(srv.rzpCalls().filter((c) => c.call === 'payments.transfer').length, 0);
  const earns = await srv.db.query(`SELECT COUNT(*)::int n FROM loyalty_transactions WHERE order_id = $1 AND type = 'earn'`, [order.id]);
  assert.equal(earns.rows[0].n, 1);
});

test('counter-paid order: commission cash_due, loyalty earned', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id);
  await srv.db.query('INSERT INTO loyalty_programs (cafe_id, points_per_rupee, is_active) VALUES ($1, 1, true)', [cafe.id]);
  const owner = await login(srv.base, cafe.email);
  const order = await placeOrder(srv.base, cafe.slug, item.id, { customer_phone: '9000000002' });
  for (const status of ['confirmed', 'preparing', 'ready', 'served']) {
    await api(srv.base, 'PATCH', `/orders/${order.id}/status`, { token: owner.token, body: { status } });
  }
  await markPaid(owner.token, order.id, { payment_mode: 'cash' });
  await sleep(500);
  const row = await orderRow(order.id);
  assert.equal(row.commission_status, 'cash_due');
  assert.ok(row.loyalty_points_earned > 0);
});

test('cancelling a prepaid order refunds it once, reversing the Route transfer', async () => {
  const cafe = await routeCafe();
  const item = await createMenuItem(srv.db, cafe.id);
  const owner = await login(srv.base, cafe.email);
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  await payOrder(srv.base, cafe.slug, order);
  const before = srv.rzpCalls().filter((c) => c.call === 'payments.refund').length;

  const cancel = await api(srv.base, 'PATCH', `/orders/${order.id}/status`, { token: owner.token, body: { status: 'cancelled', cancellation_reason: 'Out of stock' } });
  assert.equal(cancel.status, 200);
  await sleep(500);
  const refunds = srv.rzpCalls().filter((c) => c.call === 'payments.refund').slice(before);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].reverse_all, 1);
  assert.equal((await orderRow(order.id)).refund_status, 'processed');
});

test('a payment landing after cancellation is refunded and does not revive the order', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id);
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  const headers = { 'x-order-token': order.customer_token };
  const created = await api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders/${order.id}/pay`, { headers });
  await api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders/${order.id}/cancel`, { headers, body: {} });

  const rzpOrder = created.body.razorpay_order_id;
  const pay = rzpOrder.replace('order_', 'pay_');
  const sig = crypto.createHmac('sha256', RZP_SECRET).update(`${rzpOrder}|${pay}`).digest('hex');
  const v = await api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders/${order.id}/pay/verify`, {
    headers, body: { razorpay_order_id: rzpOrder, razorpay_payment_id: pay, razorpay_signature: sig },
  });
  assert.equal(v.status, 409);
  await sleep(500);
  const row = await orderRow(order.id);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.refund_status, 'processed');
});

test('commission cannot be settled with a food payment or another café\'s commission', async () => {
  const cafeA = await createCafe(srv.db);
  const cafeB = await createCafe(srv.db);
  await srv.db.query(
    `INSERT INTO orders (cafe_id, customer_name, table_number, total_amount, final_amount, status, commission_amount, commission_status)
     VALUES ($1,'X','1',1000,1000,'paid',100,'cash_due'), ($2,'X','1',1000,1000,'paid',100,'cash_due')`, [cafeA.id, cafeB.id]);
  const a = await login(srv.base, cafeA.email);
  const b = await login(srv.base, cafeB.email);
  const verify = (token, rzpOrder) => {
    const pay = rzpOrder.replace('order_', 'pay_');
    const sig = crypto.createHmac('sha256', RZP_SECRET).update(`${rzpOrder}|${pay}`).digest('hex');
    return api(srv.base, 'POST', '/payments/commission/verify', { token, body: { razorpay_order_id: rzpOrder, razorpay_payment_id: pay, razorpay_signature: sig } });
  };

  // A food order big enough to cover the commission
  const item = await createMenuItem(srv.db, cafeA.id, 'Feast', 500);
  const food = await placeOrder(srv.base, cafeA.slug, item.id);
  const foodPay = await api(srv.base, 'POST', `/orders/cafe/${cafeA.slug}/orders/${food.id}/pay`, { headers: { 'x-order-token': food.customer_token } });
  assert.equal((await verify(a.token, foodPay.body.razorpay_order_id)).status, 400);

  const bComm = await api(srv.base, 'POST', '/payments/commission/pay', { token: b.token });
  assert.equal((await verify(a.token, bComm.body.orderId)).status, 400);

  const aComm = await api(srv.base, 'POST', '/payments/commission/pay', { token: a.token });
  assert.equal((await verify(a.token, aComm.body.orderId)).status, 200);
});

test('webhook ignores payment notes forged to look like a commission payment', async () => {
  const cafe = await createCafe(srv.db);
  await srv.db.query(
    `INSERT INTO orders (cafe_id, customer_name, table_number, total_amount, final_amount, status, commission_amount, commission_status)
     VALUES ($1,'X','1',1000,1000,'paid',100,'cash_due')`, [cafe.id]);
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: {
    id: 'pay_forged', order_id: 'order_does_not_exist', amount: 100, notes: { type: 'commission_payment', cafe_id: cafe.id },
  } } } });
  const sig = crypto.createHmac('sha256', RZP_WEBHOOK_SECRET).update(raw).digest('hex');
  const res = await fetch(`${srv.base}/api/payments/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body: raw });
  assert.equal(res.status, 200);
  const r = await srv.db.query('SELECT commission_status FROM orders WHERE cafe_id = $1', [cafe.id]);
  assert.equal(r.rows[0].commission_status, 'cash_due');
});

test('webhook settles a food order when the customer never reached verify', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id);
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  const created = await api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders/${order.id}/pay`, { headers: { 'x-order-token': order.customer_token } });
  const rzpOrder = created.body.razorpay_order_id;
  const payId = rzpOrder.replace('order_', 'pay_');
  // Phone lost signal after paying: only Razorpay's webhook arrives
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: payId, order_id: rzpOrder, amount: created.body.amount, notes: {} } } } });
  const sig = crypto.createHmac('sha256', RZP_WEBHOOK_SECRET).update(raw).digest('hex');
  const hook = await fetch(`${srv.base}/api/payments/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body: raw });
  assert.equal(hook.status, 200);
  const row = await orderRow(order.id);
  assert.equal(row.payment_verified, true);
  assert.equal(row.status, 'confirmed');

  // The customer's late verify is then a harmless "already paid"
  const s = crypto.createHmac('sha256', RZP_SECRET).update(`${rzpOrder}|${payId}`).digest('hex');
  const late = await api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders/${order.id}/pay/verify`, {
    headers: { 'x-order-token': order.customer_token },
    body: { razorpay_order_id: rzpOrder, razorpay_payment_id: payId, razorpay_signature: s },
  });
  assert.equal(late.status, 409);
});

test('paying for an order the kitchen already started keeps it cooking', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id);
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  await srv.db.query(`UPDATE orders SET status = 'preparing' WHERE id = $1`, [order.id]);
  assert.equal((await payOrder(srv.base, cafe.slug, order)).status, 200);
  assert.equal((await orderRow(order.id)).status, 'preparing');
});

test('a split bill records each share and its payment mode', async () => {
  const cafe = await createCafe(srv.db);
  const item = await createMenuItem(srv.db, cafe.id, 'Thali', 300);
  const owner = await login(srv.base, cafe.email);
  const order = await placeOrder(srv.base, cafe.slug, item.id);
  for (const status of ['confirmed', 'preparing', 'ready', 'served']) {
    await api(srv.base, 'PATCH', `/orders/${order.id}/status`, { token: owner.token, body: { status } });
  }
  const bad = await api(srv.base, 'PATCH', `/orders/${order.id}/status`, {
    token: owner.token, body: { status: 'paid', payment_mode: 'split', payment_splits: [{ amount: 100, mode: 'bitcoin' }, { amount: 206, mode: 'cash' }] },
  });
  assert.equal(bad.status, 400);
  const good = await api(srv.base, 'PATCH', `/orders/${order.id}/status`, {
    token: owner.token, body: { status: 'paid', payment_mode: 'split', payment_splits: [{ amount: 153, mode: 'cash' }, { amount: 153, mode: 'upi' }] },
  });
  assert.equal(good.status, 200);
  const row = await orderRow(order.id);
  assert.equal(row.payment_mode, 'split');
  assert.deepEqual(row.payment_splits, [{ amount: 153, mode: 'cash' }, { amount: 153, mode: 'upi' }]);
});

test('cancelling one item of a prepaid order refunds that item; the last one refunds the rest', async () => {
  const cafe = await routeCafe();
  const owner = await login(srv.base, cafe.email);
  const big = await createMenuItem(srv.db, cafe.id, 'Thali', 200);
  const small = await createMenuItem(srv.db, cafe.id, 'Lassi', 100);
  const r = await api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders`, {
    body: { customer_name: 'A', table_number: '1', items: [{ menu_item_id: big.id, quantity: 1 }, { menu_item_id: small.id, quantity: 1 }] },
  });
  const order = r.body.order;
  assert.equal(Number(order.final_amount), 306); // 300 + 2% platform fee
  assert.equal((await payOrder(srv.base, cafe.slug, order)).status, 200);
  const lassi = order.items.find((i) => i.item_name === 'Lassi');
  const thali = order.items.find((i) => i.item_name === 'Thali');
  const before = srv.rzpCalls().length;

  const c1 = await api(srv.base, 'PATCH', `/orders/${order.id}/items/${lassi.id}/cancel`, { token: owner.token, body: { reason: 'Out of curd' } });
  assert.equal(c1.status, 200);
  await sleep(500);
  let mine = srv.rzpCalls().slice(before);
  assert.deepEqual(mine.map((c) => [c.call, c.amount]), [['transfers.reverse', 10000], ['payments.refund', 10200]]);
  const partial = (await srv.db.query('SELECT amount, status FROM order_refunds WHERE order_id = $1', [order.id])).rows;
  assert.deepEqual(partial.map((p) => [Number(p.amount), p.status]), [[102, 'processed']]);
  assert.equal((await orderRow(order.id)).status, 'confirmed');

  const c2 = await api(srv.base, 'PATCH', `/orders/${order.id}/items/${thali.id}/cancel`, { token: owner.token, body: { reason: 'Kitchen closed' } });
  assert.equal(c2.status, 200);
  await sleep(500);
  mine = srv.rzpCalls().slice(before);
  const last = mine[mine.length - 1];
  assert.equal(last.call, 'payments.refund');
  assert.equal(last.amount, 20400); // only what's left
  assert.equal(last.reverse_all, 1);
  const row = await orderRow(order.id);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.refund_status, 'processed');
});

test('cancelling an item of an unpaid order triggers no refund', async () => {
  const cafe = await createCafe(srv.db);
  const owner = await login(srv.base, cafe.email);
  const a = await createMenuItem(srv.db, cafe.id, 'A', 100);
  const b = await createMenuItem(srv.db, cafe.id, 'B', 100);
  const r = await api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders`, {
    body: { customer_name: 'A', table_number: '1', items: [{ menu_item_id: a.id, quantity: 1 }, { menu_item_id: b.id, quantity: 1 }] },
  });
  const before = srv.rzpCalls().length;
  await api(srv.base, 'PATCH', `/orders/${r.body.order.id}/items/${r.body.order.items[0].id}/cancel`, { token: owner.token, body: { reason: 'x' } });
  await sleep(300);
  assert.equal(srv.rzpCalls().slice(before).filter((c) => c.call === 'payments.refund').length, 0);
  assert.equal((await srv.db.query('SELECT COUNT(*)::int n FROM order_refunds WHERE order_id = $1', [r.body.order.id])).rows[0].n, 0);
});
