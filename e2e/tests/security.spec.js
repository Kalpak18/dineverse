// Attacks a customer or a curious staff member could try from a browser.
const crypto = require('node:crypto');
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, login, api, placeOrder, state, q } = require('../support');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test.describe('headers', () => {
  test.skip(({ isMobile }) => isMobile, 'same headers for every device');

  test('site sends a strict CSP and anti-framing headers', async ({ request }) => {
    const h = (await request.get('/')).headers();
    const csp = h['content-security-policy'];
    const scriptSrc = csp.match(/script-src([^;]*)/)[1];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(csp).toMatch(/object-src 'none'/);
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options'] || csp).toMatch(/DENY|SAMEORIGIN|frame-ancestors/i);
    expect(h['permissions-policy']).toContain('payment=(self "https://checkout.razorpay.com"');
  });

  test('API hides its stack and refuses foreign origins', async () => {
    const res = await fetch(`${state().apiOrigin}/api/cafes/nope-${Date.now()}`, { headers: { origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('x-powered-by')).toBeNull();
    const body = await res.text();
    expect(body).not.toMatch(/at .*\.js:\d+/); // no stack traces
    const ok = await fetch(`${state().apiOrigin}/health`, { headers: { origin: state().webOrigin } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(state().webOrigin);
  });
});

test.describe('customer API abuse', () => {
  test.skip(({ isMobile }) => isMobile, 'API-only');

  test("one customer cannot read, cancel or pay another's order", async () => {
    const c = await seedCafe();
    const { order } = await placeOrder(c.slug, [c.item['Cold Coffee'].id]);
    const { order: mine } = await placeOrder(c.slug, [c.item['Cold Coffee'].id]);
    const base = `/orders/cafe/${c.slug}/orders/${order.id}`;
    const asMe = { headers: { 'x-order-token': mine.customer_token } };
    expect((await api('GET', `${base}/status`, asMe)).status).toBe(404);
    expect((await api('POST', `${base}/cancel`, asMe)).status).toBeGreaterThanOrEqual(400);
    expect((await api('POST', `${base}/pay`, asMe)).status).toBeGreaterThanOrEqual(400);
    expect((await api('GET', `${base}/messages`, asMe)).status).toBeGreaterThanOrEqual(400);
    expect((await api('POST', `${base}/service-request`, { ...asMe, body: { type: 'bill' } })).status).toBeGreaterThanOrEqual(400);
    expect((await q('SELECT status FROM orders WHERE id = $1', [order.id]))[0].status).toBe('pending');
  });

  test('prices, quantities and items come from the server, not the client', async () => {
    const c = await seedCafe();
    const other = await seedCafe();
    const place = (items) => api('POST', `/orders/cafe/${c.slug}/orders`, { body: { customer_name: 'X', table_number: 'Table 1', items } });
    const cheap = await place([{ menu_item_id: c.item['Chicken Biryani'].id, quantity: 1, price: 1, unit_price: 1 }]);
    expect(cheap.status).toBe(201);
    expect(Number(cheap.body.order.total_amount)).toBe(280);
    for (const quantity of [0, -2, 1.5, 10_000, 'abc']) {
      expect((await place([{ menu_item_id: c.item['Cold Coffee'].id, quantity }])).status, `quantity ${quantity}`).toBe(400);
    }
    expect((await place([{ menu_item_id: other.item['Cold Coffee'].id, quantity: 1 }])).status).toBeGreaterThanOrEqual(400);
    expect((await place([])).status).toBe(400);
  });

  test("a QR secret from another café or a made-up one never verifies a table", async () => {
    const c = await seedCafe();
    const other = await seedCafe();
    for (const table_token of [other.tables['1'].qr_token, 'a'.repeat(64), "' OR 1=1 --"]) {
      const r = await api('POST', `/orders/cafe/${c.slug}/orders`, {
        body: { customer_name: 'X', table_number: 'Table 1', table_token, items: [{ menu_item_id: c.item['Cold Coffee'].id, quantity: 1 }] },
      });
      if (r.status === 201) expect(r.body.order.table_verified, table_token).not.toBe(true);
      else expect(r.status).toBeLessThan(500);
    }
    expect((await api('GET', `/orders/cafe/${c.slug}/table-qr/${other.tables['1'].qr_token}`)).status).toBe(404);
  });

  test('injection-looking input is just data', async () => {
    const r = await api('GET', `/cafes/${encodeURIComponent("x' OR '1'='1")}`);
    expect(r.status).toBe(404);
    const c = await seedCafe();
    const { order } = await placeOrder(c.slug, [c.item['Cold Coffee'].id], { customer_name: "Robert'); DROP TABLE orders;--" });
    expect(order.customer_name).toBe("Robert'); DROP TABLE orders;--");
    expect((await q('SELECT count(*)::int AS n FROM orders'))[0].n).toBeGreaterThan(0);
  });
});

test('stored XSS in names, notes and chat never executes (screens and print pop-ups)', async ({ page, context }) => {
  const c = await seedCafe();
  const payload = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;
  const { order } = await placeOrder(c.slug, [c.item['Cold Coffee'].id], {
    customer_name: `Asha${payload}`.slice(0, 100), notes: payload, table_token: c.tables['1'].qr_token,
  });
  await api('POST', `/orders/cafe/${c.slug}/orders/${order.id}/messages`, {
    headers: { 'x-order-token': order.customer_token }, body: { message: payload },
  });
  await context.addInitScript(() => { window.open = ((open) => function (...a) { const w = open.apply(window, a); if (w) w.print = () => {}; return w; })(window.open); });

  await signIn(page, c.cafe.email);
  for (const path of ['/owner/orders', '/owner/kitchen', '/owner/messages', '/owner/dashboard']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => window.__xss), path).toBeUndefined();
  }
  await page.goto('/owner/orders');
  await expect(page.getByText(/Asha<img/).filter({ visible: true }).first()).toBeVisible(); // shown as text
  const [kot] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: '📋 KOT' }).click()]);
  await kot.waitForLoadState();
  expect(await kot.evaluate(() => window.__xss)).toBeUndefined();
  expect(await kot.locator('img').count()).toBe(0);
});

test('forged or tampered sessions are thrown out to the login page', async ({ page }) => {
  const c = await seedCafe();
  const victim = await seedCafe();
  const session = await login(c.cafe.email);
  const claims = JSON.parse(Buffer.from(session.token.split('.')[1], 'base64url'));

  const forgeries = {
    'wrong secret': (() => {
      const head = b64({ alg: 'HS256', typ: 'JWT' });
      const body = b64({ ...claims, id: victim.cafe.id, cafeId: victim.cafe.id });
      return `${head}.${body}.${crypto.createHmac('sha256', 'guess').update(`${head}.${body}`).digest('base64url')}`;
    })(),
    'alg none': `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, id: victim.cafe.id })}.`,
    garbage: 'not-a-jwt',
  };
  for (const [label, token] of Object.entries(forgeries)) {
    expect((await api('GET', '/orders', { token })).status, label).toBe(401);
    await page.goto('/');
    await page.evaluate(({ token, cafe }) => {
      localStorage.setItem('dineverse_token', token);
      localStorage.setItem('dineverse_refresh_token', 'forged-refresh');
      localStorage.setItem('dineverse_role', 'OWNER');
      localStorage.setItem('dv_cafe_cache', JSON.stringify(cafe));
    }, { token, cafe: victim.cafe });
    await page.goto('/owner/orders');
    await expect(page, label).toHaveURL(/\/owner\/login/);
    await expect(page.getByText(victim.cafe.email)).toHaveCount(0);
  }
});

test('staff only reach their own screens (UI and API)', async ({ page }) => {
  const c = await seedCafe({ staff: ['kitchen', 'waiter', 'cashier'] });
  const kitchen = await signIn(page, c.staff.kitchen.email);
  for (const path of ['/owner/billing', '/owner/staff', '/owner/analytics', '/owner/orders', '/owner/menu']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/owner\/kitchen/);
  }
  const { token: waiter } = await login(c.staff.waiter.email);
  const { token: cashier } = await login(c.staff.cashier.email);
  expect((await api('GET', '/orders/stats', { token: kitchen.token })).status).toBe(403);
  expect((await api('GET', '/staff', { token: cashier })).status).toBe(403);
  expect((await api('GET', '/orders/messages/conversations', { token: waiter })).status).toBe(403);
  expect((await api('POST', '/menu/import', { token: kitchen.token, body: { rows: [] } })).status).toBe(403);
});

test('removing a staff member logs them out everywhere', async ({ page }) => {
  const c = await seedCafe({ staff: ['cashier'] });
  await signIn(page, c.staff.cashier.email);
  await page.goto('/owner/orders');
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
  const { token } = await login(c.cafe.email);
  const del = await api('DELETE', `/staff/${c.staff.cashier.id}`, { token });
  expect(del.status).toBe(200);
  await page.reload();
  await expect(page).toHaveURL(/\/owner\/login/);
});
