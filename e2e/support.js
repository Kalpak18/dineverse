// Shared helpers for e2e tests: DB access, seeding an isolated café per
// test, API calls, logging browsers in as owner/staff, Razorpay call log.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const state = () => JSON.parse(fs.readFileSync(path.join(__dirname, '.state.json'), 'utf8'));

let pool;
const db = () => (pool ||= new Pool({ connectionString: state().dbUrl, max: 4 }));
const q = async (sql, params) => (await db().query(sql, params)).rows;

async function api(method, urlPath, { token, body, headers = {} } = {}) {
  const res = await fetch(`${state().apiOrigin}/api${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

// bcrypt('pass1234', cost 4) — precomputed so the e2e package needs no bcrypt
const PASSWORD = 'pass1234';
const PASSWORD_HASH = '$2a$04$heq3V7v5rOUcwz08pdaRpuKZIh8y7CJ/KQw3.oLulMHx7W1t2sd1q';

let n = 0;
/**
 * Creates an isolated café: owner + optional staff, tables (with QR tokens),
 * a small menu. Returns everything the tests need.
 */
async function seedCafe({ staff = [], tables = ['1', '2', '3'], route = false, delivery = false, extra = {} } = {}) {
  n += 1;
  const tag = `${process.pid}-${Date.now()}-${n}`;
  const [cafe] = await q(
    `INSERT INTO cafes (name, slug, email, password_hash, setup_completed, is_open, razorpay_account_id, razorpay_route_enabled,
                        delivery_enabled, latitude, longitude, delivery_radius_km, delivery_fee_base, delivery_fee_per_km)
     VALUES ($1, $2, $3, $4, true, true, $5, $6, $7, 18.5308, 73.8475, 5, 20, 8) RETURNING *`,
    [extra.name || 'Spice Route', `e2e-${tag}`, `owner-${tag}@t.com`, PASSWORD_HASH,
     route ? 'acc_e2e' : null, route, delivery]
  );
  const [mains] = await q(`INSERT INTO categories (cafe_id, name, translations) VALUES ($1, 'Mains', '{"hi":{"name":"मुख्य व्यंजन"}}') RETURNING id`, [cafe.id]);
  const [drinks] = await q(`INSERT INTO categories (cafe_id, name, station) VALUES ($1, 'Drinks', 'Bar') RETURNING id`, [cafe.id]);
  const items = await q(
    `INSERT INTO menu_items (cafe_id, category_id, name, description, price, is_veg, default_prep_mins, translations) VALUES
       ($1, $2, 'Paneer Tikka', 'Smoky cottage cheese from the tandoor', 220, true, 12, '{"hi":{"name":"पनीर टिक्का"}}'),
       ($1, $2, 'Chicken Biryani', 'Dum-cooked rice with chicken', 280, false, 18, '{}'),
       ($1, $3, 'Cold Coffee', 'Chilled and creamy', 120, true, 5, '{}')
     RETURNING id, name, price`,
    [cafe.id, mains.id, drinks.id]
  );
  const tableRows = [];
  for (const label of tables) {
    const [t] = await q(`INSERT INTO cafe_tables (cafe_id, label) VALUES ($1, $2) RETURNING id, label, qr_token`, [cafe.id, label]);
    tableRows.push(t);
  }
  const staffRows = {};
  for (const role of staff) {
    const [s] = await q(
      `INSERT INTO cafe_staff (cafe_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, email`,
      [cafe.id, role, `${role}-${tag}@t.com`, PASSWORD_HASH, role]
    );
    staffRows[role] = s;
  }
  const item = Object.fromEntries(items.map((i) => [i.name, i]));
  return { cafe, slug: cafe.slug, item, tables: Object.fromEntries(tableRows.map((t) => [t.label, t])), staff: staffRows };
}

async function login(email) {
  const r = await api('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// Put a logged-in session into a page's localStorage (like the app does)
async function signIn(page, email) {
  const session = await login(email);
  await page.goto('/');
  await page.evaluate((s) => {
    localStorage.setItem('dineverse_token', s.token);
    localStorage.setItem('dineverse_refresh_token', s.refreshToken);
    localStorage.setItem('dineverse_role', s.role || 'OWNER');
    if (s.staffRole) localStorage.setItem('dineverse_staff_role', s.staffRole);
    localStorage.setItem('dv_cafe_cache', JSON.stringify(s.cafe));
    localStorage.setItem(`dv_welcomed_${s.cafe.id}`, '1'); // first-login modals
    localStorage.setItem(`dv_ob_done_${s.cafe.id}`, '1');
  }, session);
  return session;
}

async function placeOrder(slug, items, extra = {}) {
  const r = await api('POST', `/orders/cafe/${slug}/orders`, {
    body: { customer_name: 'Asha', table_number: 'Table 1', items: items.map((id) => ({ menu_item_id: id, quantity: 1 })), ...extra },
  });
  if (r.status !== 201) throw new Error(`placeOrder ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const rzpCalls = () => fs.readFileSync(state().rzpLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sign = (orderId, paymentId) => crypto.createHmac('sha256', state().rzpSecret).update(`${orderId}|${paymentId}`).digest('hex');

// Fails a test if the page logs CSP violations or uncaught errors
function watchPage(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to (execute|load|apply)/i.test(m.text())) problems.push(`csp: ${m.text()}`);
  });
  return problems;
}

// Customer orders through the real UI (QR scan → menu → cart → confirm)
async function orderViaUi(page, c, { items = ['Cold Coffee'], table = '1', qr = true, name = 'Asha', phone = '9876543210', type } = {}) {
  const qs = type ? '' : `?table=${table}${qr ? `&t=${c.tables[table].qr_token}` : ''}`;
  await page.goto(`/cafe/${c.slug}${qs}`);
  if (type === 'takeaway') await page.getByRole('button', { name: /Takeaway/ }).click();
  await page.getByRole('button', { name: 'View Menu →' }).click();
  const search = page.getByRole('textbox', { name: /Search dishes/ });
  for (const it of items) {
    await search.fill(it);
    await page.getByRole('button', { name: `ADD ${it}` }).click();
  }
  await page.getByRole('button', { name: /View Cart/ }).click();
  await page.getByRole('textbox', { name: 'Your name *' }).fill(name);
  await page.getByRole('textbox', { name: 'Mobile number *' }).fill(phone);
  await page.getByRole('button', { name: /^Place Order/ }).click();
  await page.getByRole('button', { name: 'Yes, Place Order' }).click();
  await page.waitForURL(/\/confirmation/);
  const [order] = await q('SELECT * FROM orders WHERE cafe_id = $1 ORDER BY created_at DESC LIMIT 1', [c.cafe.id]);
  return order;
}

// Owner-side status changes through the API (accept → … → served)
async function advance(token, orderId, to) {
  const path = ['confirmed', 'preparing', 'ready', 'served'];
  const [{ status }] = await q('SELECT status FROM orders WHERE id = $1', [orderId]);
  for (const st of path.slice(path.indexOf(status) + 1, path.indexOf(to) + 1)) {
    const r = await api('PATCH', `/orders/${orderId}/status`, { token, body: { status: st } });
    if (r.status !== 200) throw new Error(`status ${st}: ${r.status} ${JSON.stringify(r.body)}`);
  }
}

async function webhook(event) {
  const raw = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', state().rzpWebhookSecret).update(raw).digest('hex');
  return fetch(`${state().apiOrigin}/api/payments/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body: raw });
}

// Stand-in for checkout.razorpay.com/v1/checkout.js. mode: 'pay' (default)
// calls the success handler with a correctly signed payment, 'dismiss'
// closes the sheet. window.__rzpOpened records the options it was given.
async function fakeRazorpay(page, mode = 'pay') {
  await page.exposeFunction('__rzpSign', (orderId, paymentId) => sign(orderId, paymentId));
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `window.Razorpay = function (o) {
      this.on = function () {};
      this.open = async function () {
        window.__rzpOpened = { order_id: o.order_id, amount: o.amount, key: o.key, method: o.prefill && o.prefill.method };
        if (${JSON.stringify(mode)} === 'dismiss') return o.modal && o.modal.ondismiss && o.modal.ondismiss();
        const pid = o.order_id.replace('order_', 'pay_');
        o.handler({ razorpay_order_id: o.order_id, razorpay_payment_id: pid, razorpay_signature: await window.__rzpSign(o.order_id, pid) });
      };
    };`,
  }));
}

module.exports = {
  state, db, q, api, seedCafe, login, signIn, placeOrder, orderViaUi, advance, webhook, fakeRazorpay,
  rzpCalls, sign, watchPage, PASSWORD,
};
