// Sessions: refresh keeps the principal (S1), revocation (S4), outlet
// sessions survive refresh (bug #7), only café tokens reach owner APIs.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, createCafe, createStaff, login, signToken, claims } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const refresh = (refreshToken) => api(srv.base, 'POST', '/auth/refresh', { body: { refreshToken } });
const me = (token) => api(srv.base, 'GET', '/auth/me', { token });

test('staff refresh re-mints STAFF with their role, never OWNER', async () => {
  const cafe = await createCafe(srv.db);
  const staff = await createStaff(srv.db, cafe.id, 'cashier');
  const s = await login(srv.base, staff.email);
  const r = await refresh(s.refreshToken);
  assert.equal(r.status, 200);
  const c = claims(r.body.token);
  assert.equal(c.role, 'STAFF');
  assert.equal(c.staffRole, 'cashier');
  assert.equal(c.staffId, staff.id);
});

test('owner refresh stays OWNER; refresh tokens are single-use', async () => {
  const cafe = await createCafe(srv.db);
  const s = await login(srv.base, cafe.email);
  const r = await refresh(s.refreshToken);
  assert.equal(claims(r.body.token).role, 'OWNER');
  assert.equal((await refresh(s.refreshToken)).status, 401);
});

test('deactivated staff cannot refresh or use their token', async () => {
  const cafe = await createCafe(srv.db);
  const staff = await createStaff(srv.db, cafe.id, 'waiter');
  const s = await login(srv.base, staff.email);
  await srv.db.query('UPDATE cafe_staff SET is_active = false WHERE id = $1', [staff.id]);
  assert.equal((await me(s.token)).status, 401);
  assert.equal((await refresh(s.refreshToken)).status, 401);
});

test('owner resetting a staff password logs that staff member out only', async () => {
  const cafe = await createCafe(srv.db);
  const staff = await createStaff(srv.db, cafe.id, 'kitchen');
  const owner = await login(srv.base, cafe.email);
  const s = await login(srv.base, staff.email);
  const reset = await api(srv.base, 'PATCH', `/staff/${staff.id}/reset-password`, { token: owner.token, body: { new_password: 'newpass123' } });
  assert.equal(reset.status, 200);
  assert.equal((await me(s.token)).status, 401);
  assert.equal((await refresh(s.refreshToken)).status, 401);
  assert.equal((await me(owner.token)).status, 200);
});

test('bumping the owner token_version (password reset) kills owner + outlet sessions', async () => {
  const cafe = await createCafe(srv.db);
  const outlet = await createCafe(srv.db, { parent_cafe_id: cafe.id });
  const owner = await login(srv.base, cafe.email);
  const sw = await api(srv.base, 'POST', `/auth/outlets/switch/${outlet.id}`, { token: owner.token });
  assert.equal(sw.status, 200);
  assert.equal((await me(sw.body.token)).status, 200);
  await srv.db.query('UPDATE cafes SET token_version = token_version + 1 WHERE id = $1', [cafe.id]);
  assert.equal((await me(owner.token)).status, 401);
  assert.equal((await me(sw.body.token)).status, 401);
});

test('refreshing an outlet session keeps the owner on that outlet', async () => {
  const cafe = await createCafe(srv.db);
  const outlet = await createCafe(srv.db, { parent_cafe_id: cafe.id });
  const owner = await login(srv.base, cafe.email);
  const sw = await api(srv.base, 'POST', `/auth/outlets/switch/${outlet.id}`, { token: owner.token });
  const r = await refresh(sw.body.refreshToken);
  const c = claims(r.body.token);
  assert.equal(c.cafeId, outlet.id);
  assert.equal(c.rootCafeId, cafe.id);
});

test('rider tokens carrying a cafeId are rejected by owner APIs', async () => {
  const cafe = await createCafe(srv.db);
  const rider = signToken({ riderId: 'r1', cafeId: cafe.id, role: 'RIDER', tv: 1 });
  assert.equal((await me(rider)).status, 401);
});
