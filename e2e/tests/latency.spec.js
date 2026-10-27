// Latency and load. Budgets are generous (CI machines are slow); the
// numbers are printed so regressions are visible in the log.
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, api, q } = require('../support');

test.skip(({ isMobile }) => isMobile, 'measured once, on desktop');

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
async function timed(fn) { const t = performance.now(); const r = await fn(); return { ms: performance.now() - t, r }; }

test('API under a lunch rush: 60 menu loads and 40 orders at once', async () => {
  const c = await seedCafe();
  const menu = await Promise.all(Array.from({ length: 60 }, () => timed(() => api('GET', `/cafes/${c.slug}/menu`))));
  expect(menu.every((m) => m.r.status === 200)).toBe(true);

  const orders = await Promise.all(Array.from({ length: 40 }, (_, i) => timed(() => api('POST', `/orders/cafe/${c.slug}/orders`, {
    body: { customer_name: `Guest ${i}`, table_number: `Table ${(i % 3) + 1}`, items: [{ menu_item_id: c.item['Cold Coffee'].id, quantity: 1 }] },
  }))));
  const failed = orders.filter((o) => o.r.status !== 201).map((o) => `${o.r.status} ${JSON.stringify(o.r.body).slice(0, 160)}`);
  expect(failed).toEqual([]);

  // Every order gets its own kitchen number, no gaps or repeats under concurrency
  const nums = (await q('SELECT daily_order_number AS n FROM orders WHERE cafe_id = $1', [c.cafe.id])).map((r) => Number(r.n)).sort((a, b) => a - b);
  expect(nums).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));

  const m = menu.map((x) => x.ms), o = orders.map((x) => x.ms);
  console.log(`menu   p50 ${pct(m, 0.5).toFixed(0)}ms  p95 ${pct(m, 0.95).toFixed(0)}ms`);
  console.log(`orders p50 ${pct(o, 0.5).toFixed(0)}ms  p95 ${pct(o, 0.95).toFixed(0)}ms`);
  expect(pct(m, 0.95)).toBeLessThan(1500);
  expect(pct(o, 0.95)).toBeLessThan(3000);
});

test('pages become usable quickly on a throttled 4G phone', async ({ page, browser }) => {
  const c = await seedCafe();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  // ≈ "Fast 4G": 9 Mbps down, 1.5 Mbps up, 60 ms RTT
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  let bytes = 0;
  page.on('response', async (r) => { if (r.url().startsWith('http://localhost')) bytes += Number(r.headers()['content-length'] || (await r.body().catch(() => '')).length || 0); });

  const entry = await timed(async () => {
    await page.goto(`/cafe/${c.slug}?table=1&t=${c.tables['1'].qr_token}`);
    await expect(page.getByRole('button', { name: 'View Menu →' })).toBeVisible();
  });
  const menu = await timed(async () => {
    await page.getByRole('button', { name: 'View Menu →' }).click();
    await expect(page.getByRole('button', { name: /^ADD / }).first()).toBeVisible();
  });
  console.log(`QR scan → entry usable ${entry.ms.toFixed(0)}ms, → menu usable ${menu.ms.toFixed(0)}ms, ${(bytes / 1024).toFixed(0)} KB loaded (uncompressed)`);
  expect(entry.ms).toBeLessThan(6000);
  expect(menu.ms).toBeLessThan(3000);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const owner = await ctx.newPage();
  await signIn(owner, c.cafe.email);
  const kitchen = await timed(async () => {
    await owner.goto('/owner/kitchen');
    await expect(owner.getByRole('region', { name: 'New orders' })).toBeVisible();
  });
  console.log(`owner kitchen screen usable ${kitchen.ms.toFixed(0)}ms`);
  expect(kitchen.ms).toBeLessThan(4000);
  await ctx.close();
});
