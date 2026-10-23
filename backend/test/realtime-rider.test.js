// Live-orders socket room is private to the café (S2); rider app endpoints
// work for café and self-registered riders (bug #3).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { startServer, api, createCafe, login, signToken, sleep } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('only owner/staff of the café receive its live order events', async () => {
  const cafe = await createCafe(srv.db);
  const other = await createCafe(srv.db);
  const owner = await login(srv.base, cafe.email);
  const entry = await srv.db.query(`INSERT INTO waitlist (cafe_id, customer_name) VALUES ($1, 'Guest') RETURNING id`, [cafe.id]);

  const identities = {
    anonymous: null,
    rider: signToken({ riderId: 'r1', cafeId: cafe.id, role: 'RIDER', tv: 1 }),
    otherOwner: signToken({ cafeId: other.id, role: 'OWNER', tv: 1 }),
    staff: signToken({ cafeId: cafe.id, role: 'STAFF', staffId: 's1', staffRole: 'kitchen', tv: 1 }),
    owner: owner.token,
  };
  const received = {};
  const sockets = Object.entries(identities).map(([name, token]) => {
    received[name] = false;
    const s = io(srv.base, { auth: (cb) => cb({ token }), transports: ['websocket'] });
    s.on('connect', () => s.emit('join_cafe', cafe.id));
    s.on('waitlist_update', () => { received[name] = true; });
    return s;
  });
  await sleep(800);
  await api(srv.base, 'DELETE', `/waitlist/${entry.rows[0].id}`, { token: owner.token });
  await sleep(500);
  sockets.forEach((s) => s.close());

  assert.deepEqual(received, { anonymous: false, rider: false, otherOwner: false, staff: true, owner: true });
});

test('café riders and self-registered riders can use the jobs API', async () => {
  const cafe = await createCafe(srv.db, { delivery_enabled: true });
  const cafeRider = await srv.db.query(`INSERT INTO cafe_riders (cafe_id, name, email) VALUES ($1, 'R1', 'r1@t.com') RETURNING id`, [cafe.id]);
  const freelancer = await srv.db.query(`INSERT INTO cafe_riders (name, email, is_self_registered) VALUES ('R2', 'r2@t.com', true) RETURNING id`);

  for (const [riderId, cafeId] of [[cafeRider.rows[0].id, cafe.id], [freelancer.rows[0].id, null]]) {
    await srv.db.query(
      `INSERT INTO orders (cafe_id, customer_name, order_type, total_amount, final_amount, rider_id, delivery_status, customer_token)
       VALUES ($1, 'C', 'delivery', 100, 100, $2, 'assigned', 'secret')`, [cafe.id, riderId]);
    const token = signToken({ riderId, cafeId, role: 'RIDER', tv: 1 });
    assert.equal((await api(srv.base, 'GET', '/rider/auth/me', { token })).status, 200);
    const jobs = await api(srv.base, 'GET', '/rider/jobs', { token });
    assert.equal(jobs.status, 200);
    assert.equal(jobs.body.jobs.length, 1);
    const job = await api(srv.base, 'GET', `/rider/jobs/${jobs.body.jobs[0].id}`, { token });
    assert.equal(job.status, 200);
    assert.equal(job.body.job.customer_token, undefined);
    assert.equal((await api(srv.base, 'PATCH', `/rider/jobs/${jobs.body.jobs[0].id}/status`, { token, body: { status: 'picked_up' } })).status, 200);
    assert.equal((await api(srv.base, 'PATCH', '/rider/location', { token, body: { lat: 18.5, lng: 73.8 } })).status, 200);
  }
});
