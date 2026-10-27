// Integration-test harness: each test file gets a fresh Postgres database
// with every migration applied, and the real API server running in a child
// process with a fake Razorpay (see razorpayStub.js).
//
// Needs a reachable Postgres. TEST_PG_URL points at a database the tests can
// connect to with CREATE DATABASE rights (default: postgres://localhost/postgres).
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const ADMIN_URL = process.env.TEST_PG_URL || 'postgres://localhost/postgres';
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const RZP_SECRET = 'rzp_test_secret';
const RZP_WEBHOOK_SECRET = 'rzp_test_webhook_secret';
const PASSWORD = 'pass1234';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

// A port the OS confirms is free right now (random picks could collide when
// test files run in parallel)
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function startServer() {
  const dbName = `dineverse_test_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: ADMIN_URL });
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const DATABASE_URL = url.toString();
  execFileSync('node', ['scripts/migrate.js'], { cwd: ROOT, env: { ...process.env, DATABASE_URL }, stdio: 'ignore' });

  const rzpLog = path.join(os.tmpdir(), `${dbName}.rzp.log`);
  fs.writeFileSync(rzpLog, '');
  const port = await freePort();
  const serverLog = path.join(os.tmpdir(), `${dbName}.server.log`);
  const logFd = fs.openSync(serverLog, 'w');
  const child = spawn('node', ['-r', path.join(__dirname, 'razorpayStub.js'), 'src/app.js'], {
    cwd: ROOT,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL,
      JWT_SECRET,
      CLIENT_URL: 'http://localhost:5173',
      RAZORPAY_KEY_ID: 'rzp_test',
      RAZORPAY_KEY_SECRET: RZP_SECRET,
      RAZORPAY_WEBHOOK_SECRET: RZP_WEBHOOK_SECRET,
      RZP_LOG: rzpLog,
      REDIS_URL: '',
      RESEND_API_KEY: '',
    },
  });

  const base = `http://localhost:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { // up to 30 s — CI machines can be slow
    try { up = (await fetch(`${base}/`)).ok; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) {
    child.kill();
    const tail = fs.readFileSync(serverLog, 'utf8').split('\n').slice(-20).join('\n');
    throw new Error(`Test API server did not start on ${base}. Last log lines:\n${tail}`);
  }

  const db = new Pool({ connectionString: DATABASE_URL });
  return {
    base,
    db,
    rzpCalls: () => fs.readFileSync(rzpLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    async stop() {
      child.kill();
      await db.end();
      const a = new Pool({ connectionString: ADMIN_URL });
      await a.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
      await a.end();
      fs.rmSync(rzpLog, { force: true });
      fs.closeSync(logFd);
      fs.rmSync(serverLog, { force: true });
    },
  };
}

// fetch wrapper → { status, body }
async function api(base, method, urlPath, { token, body, headers = {} } = {}) {
  const res = await fetch(`${base}/api${urlPath}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

let n = 0;
async function createCafe(db, fields = {}) {
  n += 1;
  const row = {
    name: `Cafe ${n}`, slug: `cafe-${n}-${Date.now()}`, email: `owner${n}-${Date.now()}@t.com`,
    password_hash: PASSWORD_HASH, setup_completed: true, ...fields,
  };
  const cols = Object.keys(row);
  const r = await db.query(
    `INSERT INTO cafes (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    Object.values(row)
  );
  return r.rows[0];
}

async function createStaff(db, cafeId, role) {
  const r = await db.query(
    `INSERT INTO cafe_staff (cafe_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [cafeId, role, `${role}-${cafeId.slice(0, 8)}-${Date.now()}@t.com`, PASSWORD_HASH, role]
  );
  return r.rows[0];
}

async function createMenuItem(db, cafeId, name = 'Thali', price = 200) {
  const r = await db.query('INSERT INTO menu_items (cafe_id, name, price) VALUES ($1,$2,$3) RETURNING *', [cafeId, name, price]);
  return r.rows[0];
}

async function login(base, identifier) {
  const { status, body } = await api(base, 'POST', '/auth/login', { body: { identifier, password: PASSWORD } });
  if (status !== 200) throw new Error(`login ${identifier} failed: ${status} ${JSON.stringify(body)}`);
  return body;
}

const signToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
const claims = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

// Customer places a dine-in order; returns { order } incl. customer_token
async function placeOrder(base, slug, menuItemId, extra = {}) {
  const { status, body } = await api(base, 'POST', `/orders/cafe/${slug}/orders`, {
    body: { customer_name: 'Asha', table_number: '3', items: [{ menu_item_id: menuItemId, quantity: 1 }], ...extra },
  });
  if (status !== 201) throw new Error(`placeOrder failed: ${status} ${JSON.stringify(body)}`);
  return body.order;
}

// Customer pays an order through the (fake) Razorpay checkout
async function payOrder(base, slug, order) {
  const headers = { 'x-order-token': order.customer_token };
  const created = await api(base, 'POST', `/orders/cafe/${slug}/orders/${order.id}/pay`, { headers });
  const rzpOrder = created.body.razorpay_order_id;
  const paymentId = rzpOrder.replace('order_', 'pay_');
  const signature = crypto.createHmac('sha256', RZP_SECRET).update(`${rzpOrder}|${paymentId}`).digest('hex');
  return api(base, 'POST', `/orders/cafe/${slug}/orders/${order.id}/pay/verify`, {
    headers,
    body: { razorpay_order_id: rzpOrder, razorpay_payment_id: paymentId, razorpay_signature: signature },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  startServer, api, createCafe, createStaff, createMenuItem, login, signToken, claims,
  placeOrder, payOrder, sleep, RZP_SECRET, RZP_WEBHOOK_SECRET,
};
