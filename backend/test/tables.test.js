// Table integrity: nobody can put an order (and its charge) on another
// table's bill, move someone else's order, or ride on someone else's party.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, createCafe, createStaff, createMenuItem, login } = require('./helpers');

let srv, cafe, owner, item, t6, t9;
before(async () => {
  srv = await startServer();
  cafe = await createCafe(srv.db);
  owner = (await login(srv.base, cafe.email)).token;
  item = await createMenuItem(srv.db, cafe.id, 'Thali', 200);
  t6 = (await srv.db.query(`INSERT INTO cafe_tables (cafe_id, label) VALUES ($1, '6') RETURNING id, qr_token`, [cafe.id])).rows[0];
  t9 = (await srv.db.query(`INSERT INTO cafe_tables (cafe_id, label) VALUES ($1, '9') RETURNING id, qr_token`, [cafe.id])).rows[0];
});
after(async () => { await srv.stop(); });

const order = async (body) => {
  const r = await api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/orders`, {
    body: { customer_name: 'X', items: [{ menu_item_id: item.id, quantity: 1 }], ...body },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};
const row = async (id) => (await srv.db.query('SELECT table_number, table_verified, party_id, moved_from_table FROM orders WHERE id = $1', [id])).rows[0];
const tableBill = (label, tokens) => api(srv.base, 'GET', `/orders/cafe/${cafe.slug}/table-bill/${encodeURIComponent(label)}`, { headers: { 'x-order-tokens': tokens.join(',') } });

test('scanning the table QR verifies the table — the typed table number is ignored', async () => {
  const r = await order({ table_number: 'Table 99', table_token: t6.qr_token });
  const o = await row(r.order.id);
  assert.equal(o.table_number, 'Table 6');
  assert.equal(o.table_verified, true);
});

test('a typed table (no QR) is held unverified and never lands on that table\'s bill', async () => {
  const victim = await order({ table_token: t6.qr_token, customer_name: 'Victim' });
  const prank = await order({ table_number: 'Table 6', customer_name: 'Prankster' });
  assert.equal((await row(prank.order.id)).table_verified, false);

  // Victim's table bill shows only their verified order
  const bill = await tableBill('Table 6', [victim.order.customer_token]);
  assert.equal(bill.status, 200);
  const ids = bill.body.orders.map((o) => o.id);
  assert.ok(ids.includes(victim.order.id));
  assert.ok(!ids.includes(prank.order.id), 'prank order must not be on the victim\'s bill');

  // …and the prankster's own token doesn't open Table 6's bill
  assert.equal((await tableBill('Table 6', [prank.order.customer_token])).status, 404);
});

test('a forged or other café\'s QR token does not verify', async () => {
  const other = await createCafe(srv.db);
  const otherTable = (await srv.db.query(`INSERT INTO cafe_tables (cafe_id, label) VALUES ($1, '6') RETURNING qr_token`, [other.id])).rows[0];
  const a = await order({ table_number: 'Table 6', table_token: otherTable.qr_token });
  const b = await order({ table_number: 'Table 6', table_token: 'f'.repeat(64) });
  assert.equal((await row(a.order.id)).table_verified, false);
  assert.equal((await row(b.order.id)).table_verified, false);
});

test('parties come from a server secret — a guessed/forged secret starts a new party', async () => {
  const first = await order({ table_token: t6.qr_token });
  assert.ok(first.party_secret);
  const second = await order({ table_token: t6.qr_token, party_secret: first.party_secret });
  const forged = await order({ table_token: t6.qr_token, party_secret: 'not-a-real-secret' });
  assert.equal((await row(second.order.id)).party_id, (await row(first.order.id)).party_id);
  assert.notEqual((await row(forged.order.id)).party_id, (await row(first.order.id)).party_id);
});

test('customer move needs their own order tokens AND the new table\'s QR', async () => {
  const mine = await order({ table_token: t6.qr_token });
  const someoneElse = await order({ table_token: t6.qr_token });
  const move = (headers, body) => api(srv.base, 'POST', `/orders/cafe/${cafe.slug}/move-table`, { headers, body });

  assert.equal((await move({ 'x-order-tokens': mine.order.customer_token }, {})).status, 400); // no QR
  assert.equal((await move({}, { table_token: t9.qr_token })).status, 400); // no order tokens
  assert.equal((await move({ 'x-order-tokens': 'f'.repeat(48) }, { table_token: t9.qr_token })).status, 404); // not my orders

  const ok = await move({ 'x-order-tokens': mine.order.customer_token }, { table_token: t9.qr_token });
  assert.equal(ok.status, 200);
  const moved = await row(mine.order.id);
  assert.deepEqual([moved.table_number, moved.table_verified, moved.moved_from_table], ['Table 9', true, 'Table 6']);
  assert.equal((await row(someoneElse.order.id)).table_number, 'Table 6', 'other customers\' orders untouched');
});

test('staff confirm/move a whole party; kitchen staff cannot', async () => {
  const waiter = (await login(srv.base, (await createStaff(srv.db, cafe.id, 'waiter')).email)).token;
  const kitchen = (await login(srv.base, (await createStaff(srv.db, cafe.id, 'kitchen')).email)).token;
  const a = await order({ table_number: 'Table 6' }); // unverified
  const b = await order({ table_number: 'Table 6', party_secret: a.party_secret });

  assert.equal((await api(srv.base, 'PATCH', `/orders/${a.order.id}/table`, { token: kitchen, body: { table_id: t6.id } })).status, 403);
  const r = await api(srv.base, 'PATCH', `/orders/${a.order.id}/table`, { token: waiter, body: { table_id: t6.id } });
  assert.equal(r.status, 200);
  assert.equal((await row(a.order.id)).table_verified, true);
  assert.equal((await row(b.order.id)).table_verified, true, 'whole party confirmed');

  // A table from another café can't be used
  const other = await createCafe(srv.db);
  const foreign = (await srv.db.query(`INSERT INTO cafe_tables (cafe_id, label) VALUES ($1, 'X') RETURNING id`, [other.id])).rows[0];
  assert.equal((await api(srv.base, 'PATCH', `/orders/${a.order.id}/table`, { token: waiter, body: { table_id: foreign.id } })).status, 404);
});

test('bill reminders skip unconfirmed orders', async () => {
  const c = await createCafe(srv.db);
  const tok = (await login(srv.base, c.email)).token;
  const it = await createMenuItem(srv.db, c.id);
  await api(srv.base, 'POST', `/orders/cafe/${c.slug}/orders`, { body: { customer_name: 'P', table_number: 'Table 4', items: [{ menu_item_id: it.id, quantity: 1 }] } });
  await srv.db.query(`UPDATE orders SET status = 'served' WHERE cafe_id = $1`, [c.id]);
  assert.equal((await api(srv.base, 'POST', '/orders/table/Table%204/remind', { token: tok })).status, 404);
});

test('QR tokens never appear in public responses; rotating invalidates the old one', async () => {
  for (const path of [`/cafes/${cafe.slug}/tables`, `/cafes/${cafe.slug}/available-tables`]) {
    const r = await api(srv.base, 'GET', path);
    assert.ok(!JSON.stringify(r.body).includes(t6.qr_token), `${path} leaked a QR token`);
  }
  assert.equal((await api(srv.base, 'GET', `/orders/cafe/${cafe.slug}/table-qr/${t6.qr_token}`)).body.table_number, 'Table 6');

  const rotated = await api(srv.base, 'POST', `/tables/${t6.id}/rotate-qr`, { token: owner });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.table.qr_token, t6.qr_token);
  const stale = await order({ table_number: 'Table 6', table_token: t6.qr_token });
  assert.equal((await row(stale.order.id)).table_verified, false);
  t6.qr_token = rotated.body.table.qr_token;
});
