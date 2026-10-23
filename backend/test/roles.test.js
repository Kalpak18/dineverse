// Staff role access matches the owner nav (S5, bug #13).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, createCafe, createStaff, login } = require('./helpers');

let srv;
let tokens;
before(async () => {
  srv = await startServer();
  const cafe = await createCafe(srv.db);
  tokens = { owner: (await login(srv.base, cafe.email)).token };
  for (const role of ['manager', 'cashier', 'kitchen', 'waiter']) {
    tokens[role] = (await login(srv.base, (await createStaff(srv.db, cafe.id, role)).email)).token;
  }
});
after(async () => { await srv.stop(); });

// [label, method, path, roles allowed besides owner]
const MATRIX = [
  ['orders list',      'GET',  '/orders',                    ['manager', 'cashier', 'kitchen', 'waiter']],
  ['menu edit',        'POST', '/menu/categories',           ['manager']],
  ['add-ons',          'GET',  '/modifiers/groups',          ['manager']],
  ['loyalty adjust',   'POST', '/loyalty/customers/adjust',  ['manager']],
  ['offers',           'GET',  '/offers',                    ['manager']],
  ['analytics',        'GET',  '/analytics',                 ['manager']],
  ['customers',        'GET',  '/customers',                 ['manager']],
  ['schedule',         'PATCH','/cafes/schedule',            ['manager']],
  ['riders',           'GET',  '/delivery/riders',           ['manager', 'cashier']],
  ['shifts',           'GET',  '/shifts/current',            ['manager', 'cashier']],
  ['chats',            'GET',  '/orders/messages/conversations', ['manager', 'cashier']],
  ['reservations',     'GET',  '/reservations',              ['manager', 'cashier']],
  ['waitlist',         'GET',  '/waitlist',                  ['manager', 'cashier']],
  ['staff',            'GET',  '/staff',                     []],
  ['commission',       'GET',  '/payments/commission',       []],
];

for (const [label, method, path, allowed] of MATRIX) {
  test(`${label}: owner + [${allowed.join(', ')}] only`, async () => {
    for (const role of Object.keys(tokens)) {
      const { status } = await api(srv.base, method, path, { token: tokens[role], body: method === 'GET' ? undefined : {} });
      const shouldPass = role === 'owner' || allowed.includes(role);
      if (shouldPass) assert.ok(![401, 403].includes(status), `${role} should reach ${method} ${path} (got ${status})`);
      else assert.equal(status, 403, `${role} must be refused ${method} ${path}`);
    }
  });
}

test('kitchen and waiter staff cannot mark an order paid', async () => {
  const cafe = await createCafe(srv.db);
  const kitchen = (await login(srv.base, (await createStaff(srv.db, cafe.id, 'kitchen')).email)).token;
  const o = await srv.db.query(
    `INSERT INTO orders (cafe_id, customer_name, table_number, total_amount, final_amount, status) VALUES ($1,'X','1',10,10,'served') RETURNING id`, [cafe.id]);
  const r = await api(srv.base, 'PATCH', `/orders/${o.rows[0].id}/status`, { token: kitchen, body: { status: 'paid', payment_mode: 'cash' } });
  assert.equal(r.status, 403);
});
