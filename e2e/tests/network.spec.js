// Bad networks: offline, lost responses, slow or failing API, expired
// sessions, dropped realtime connection.
const crypto = require('node:crypto');
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, placeOrder, state, q } = require('../support');

const orderCount = async (cafeId) => (await q('SELECT count(*)::int AS n FROM orders WHERE cafe_id = $1', [cafeId]))[0].n;

async function toCart(page, c, item = 'Cold Coffee') {
  await page.goto(`/cafe/${c.slug}?table=1&t=${c.tables['1'].qr_token}`);
  await page.getByRole('button', { name: 'View Menu →' }).click();
  await page.getByRole('textbox', { name: /Search dishes/ }).fill(item);
  await page.getByRole('button', { name: `ADD ${item}` }).click();
  await page.getByRole('button', { name: /View Cart/ }).click();
  await page.getByRole('textbox', { name: 'Your name *' }).fill('Asha');
  await page.getByRole('textbox', { name: 'Mobile number *' }).fill('9876543210');
}
const submit = async (page) => {
  await page.getByRole('button', { name: /^Place Order/ }).click();
  await page.getByRole('button', { name: 'Yes, Place Order' }).click();
};

test('offline at checkout: clear message, cart kept, order goes through once back online', async ({ page, context }) => {
  test.setTimeout(90_000);
  const c = await seedCafe();
  await toCart(page, c);
  await context.setOffline(true);
  await submit(page);
  await expect(page.getByText(/Connection issue — your order is safe/).first()).toBeVisible({ timeout: 20_000 });
  expect(await orderCount(c.cafe.id)).toBe(0);
  await expect(page.getByText('Cold Coffee').first()).toBeVisible(); // cart kept

  await context.setOffline(false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page).toHaveURL(/\/confirmation/);
  expect(await orderCount(c.cafe.id)).toBe(1);
});

test('response lost after the server took the order: retrying never duplicates it', async ({ page }) => {
  test.setTimeout(90_000);
  const c = await seedCafe();
  await toCart(page, c);
  let reached = 0;
  // Every attempt reaches the server, but the phone never hears back
  await page.route('**/api/orders/cafe/*/orders', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    reached += 1;
    await route.fetch();
    await route.abort('connectionreset');
  });
  await submit(page);
  await expect(page.getByText(/Connection issue — your order is safe/).first()).toBeVisible({ timeout: 20_000 });
  expect(reached).toBe(3); // auto-retried with backoff

  await page.unroute('**/api/orders/cafe/*/orders');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page).toHaveURL(/\/confirmation/);
  expect(await orderCount(c.cafe.id)).toBe(1);
});

test('double-tapping Place Order creates one order', async ({ page }) => {
  const c = await seedCafe();
  await toCart(page, c);
  await page.route('**/api/orders/cafe/*/orders', async (r) => { await new Promise((ok) => setTimeout(ok, 800)); await r.continue(); });
  await page.getByRole('button', { name: /^Place Order/ }).click();
  const yes = page.getByRole('button', { name: 'Yes, Place Order' });
  await yes.click();
  await yes.click({ force: true, timeout: 1000 }).catch(() => {});
  await expect(page).toHaveURL(/\/confirmation/);
  await new Promise((r) => setTimeout(r, 1000));
  expect(await orderCount(c.cafe.id)).toBe(1);
});

test('menu API down: retry screen, then recovers by itself', async ({ page }) => {
  const c = await seedCafe();
  let fail = true;
  await page.route(`**/api/cafes/${c.slug}/menu`, (r) => (fail ? r.fulfill({ status: 503, body: 'down' }) : r.continue()));
  await page.goto(`/cafe/${c.slug}?table=1&t=${c.tables['1'].qr_token}`);
  await page.getByRole('button', { name: 'View Menu →' }).click();
  await expect(page.getByRole('heading', { name: 'Waking up the kitchen…' })).toBeVisible();
  fail = false;
  await expect(page.getByRole('button', { name: /ADD/ }).first()).toBeVisible({ timeout: 15_000 });
});

test('very slow API still renders the menu, with a loading state meanwhile', async ({ page }) => {
  const c = await seedCafe();
  await page.goto(`/cafe/${c.slug}?table=1&t=${c.tables['1'].qr_token}`);
  await page.route('**/api/**', async (r) => { await new Promise((ok) => setTimeout(ok, 2500)); await r.continue(); });
  const t0 = Date.now();
  await page.getByRole('button', { name: 'View Menu →' }).click();
  await expect(page.getByRole('button', { name: /ADD/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /ADD/ }).first()).toBeVisible({ timeout: 20_000 });
  expect(Date.now() - t0).toBeGreaterThan(2500);
});

test('expired access token is renewed silently', async ({ page }) => {
  const c = await seedCafe();
  const s = await signIn(page, c.cafe.email);
  const [h, p] = s.token.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  const body = Buffer.from(JSON.stringify({ ...claims, iat: claims.iat - 7200, exp: Math.floor(Date.now() / 1000) - 60 })).toString('base64url');
  const expired = `${h}.${body}.${crypto.createHmac('sha256', state().jwtSecret).update(`${h}.${body}`).digest('base64url')}`;
  await page.evaluate((t) => localStorage.setItem('dineverse_token', t), expired);

  await page.goto('/owner/orders');
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/owner\/orders/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dineverse_token'))).not.toBe(expired);
});

for (const screen of ['kitchen', 'orders']) {
test(`${screen} screen: orders placed while the live connection is down appear after reconnect`, async ({ page }) => {
  test.setTimeout(90_000);
  const c = await seedCafe();
  let down = false;
  const sockets = [];
  await page.routeWebSocket(/socket\.io/, (ws) => {
    if (down) return ws.close();
    ws.connectToServer();
    sockets.push(ws);
  });
  await page.route(/socket\.io\/.*transport=polling/, (r) => (down ? r.abort('internetdisconnected') : r.continue()));

  await signIn(page, c.cafe.email);
  await page.goto(`/owner/${screen}`);
  await placeOrder(c.slug, [c.item['Cold Coffee'].id], { customer_name: 'Live' });
  await expect(page.getByText('Live').filter({ visible: true }).first()).toBeVisible();

  // Connection drops; an order arrives while the screen is offline
  down = true;
  for (const ws of sockets) await ws.close().catch(() => {});
  await placeOrder(c.slug, [c.item['Cold Coffee'].id], { customer_name: 'Missed' });
  await page.waitForTimeout(3000);
  down = false;
  await expect(page.getByText('Missed').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
});
}
