// Kitchen screen reliability: nothing a cook does or sees is lost to a bad
// network, another screen, or a partial live update.
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, login, placeOrder, advance, api, q } = require('../support');

const twoItems = (c) => [c.item['Paneer Tikka'].id, c.item['Cold Coffee'].id];
const statusOf = async (id) => (await q('SELECT status FROM orders WHERE id = $1', [id]))[0].status;

async function readyOrder(c, extra = {}) {
  const { token } = await login(c.cafe.email);
  const { order } = await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token, customer_name: 'Asha', ...extra });
  await advance(token, order.id, 'ready');
  return { order, token };
}

// Cut this page's live connection (socket.io over websocket + polling)
async function liveLink(page) {
  let down = false;
  const sockets = [];
  await page.routeWebSocket(/socket\.io/, (ws) => {
    if (down) return ws.close();
    ws.connectToServer();
    sockets.push(ws);
  });
  await page.route(/socket\.io\/.*transport=polling/, (r) => (down ? r.abort('internetdisconnected') : r.continue()));
  return {
    cut: async () => {
      // socket.io starts on polling and upgrades to a websocket a moment later
      // (the page has two: notification bell + this screen) — let both settle
      await expect.poll(() => sockets.length).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 2000));
      down = true;
      for (const ws of sockets) await ws.close().catch(() => {});
    },
    restore: () => { down = false; },
  };
}

test('an order stays on the kitchen screen when staff move its table', async ({ page }) => {
  const c = await seedCafe();
  const { order, token } = await readyOrder(c);
  await signIn(page, c.cafe.email);
  await page.goto('/owner/kitchen');
  const asha = page.getByText('Asha').filter({ visible: true }).first();
  await expect(asha).toBeVisible();

  const moved = await api('PATCH', `/orders/${order.id}/table`, { token, body: { table_id: c.tables['3'].id } });
  expect(moved.status).toBe(200);
  await expect(page.getByText(/Table 3/).filter({ visible: true }).first()).toBeVisible(); // update applied…
  await expect(asha).toBeVisible();                                                      // …order not dropped
});

test('a tap during a network blip is retried until it lands', async ({ page }) => {
  const c = await seedCafe();
  const { order } = await readyOrder(c);
  await signIn(page, c.cafe.email);
  await page.goto('/owner/kitchen');

  let failures = 2;
  await page.route('**/api/orders/*/status', (r) => (failures-- > 0 ? r.abort('internetdisconnected') : r.continue()));
  await page.getByRole('button', { name: 'Mark as Served →' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Not saved yet|Saving/ })).toBeVisible();
  await expect.poll(() => statusOf(order.id), { timeout: 15_000 }).toBe('served');
  await expect(page.getByRole('status').filter({ hasText: /Not saved yet|Saving/ })).toHaveCount(0);
});

test('a tap whose reply was lost is not reported as a clash', async ({ page }) => {
  const c = await seedCafe();
  const { order } = await readyOrder(c);
  await signIn(page, c.cafe.email);
  await page.goto('/owner/kitchen');

  let first = true;
  await page.route('**/api/orders/*/status', async (r) => {
    if (!first) return r.continue();
    first = false;
    await r.fetch();                 // the server applies it…
    await r.abort('connectionreset'); // …but the reply never arrives
  });
  await page.getByRole('button', { name: 'Mark as Served →' }).click();
  await expect.poll(() => statusOf(order.id)).toBe('served');
  await expect(page.getByText('Asha').filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText(/Already changed on another screen/)).toHaveCount(0);
});

test('two screens: the slower one is told and shows the latest, no error', async ({ page, browser }) => {
  const c = await seedCafe();
  const { order } = await readyOrder(c);

  // Screen B is offline, so it still shows the order as Ready
  await signIn(page, c.cafe.email);
  const link = await liveLink(page);
  await page.goto('/owner/kitchen');
  await expect(page.getByRole('button', { name: 'Mark as Served →' })).toBeVisible();
  await link.cut();

  // Screen A serves it
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await signIn(a, c.cafe.email);
  await a.goto('/owner/kitchen');
  await a.getByRole('button', { name: 'Mark as Served →' }).click();
  await expect.poll(() => statusOf(order.id)).toBe('served');

  // Screen B taps the same order
  link.restore();
  await page.getByRole('button', { name: 'Mark as Served →' }).click();
  // B wanted it served and it is — no error, no double action
  await expect(page.getByText(/→ Served/).first()).toBeVisible();
  await expect(page.getByText(/Couldn't|Failed/)).toHaveCount(0);
  await expect(page.getByText('Asha').filter({ visible: true })).toHaveCount(0);
  expect(await statusOf(order.id)).toBe('served'); // B didn't undo A's work
  await ctxA.close();
});

test('lost live connection: offline banner, and new orders still arrive', async ({ page }) => {
  test.setTimeout(90_000);
  const c = await seedCafe();
  await signIn(page, c.cafe.email);
  const link = await liveLink(page);
  await page.goto('/owner/kitchen');
  await expect(page.getByRole('heading', { name: 'Kitchen', level: 1 })).toBeVisible();

  await link.cut();
  await expect(page.getByRole('alert').filter({ hasText: /Offline/ })).toBeVisible({ timeout: 15_000 });
  // While offline the screen checks for orders itself
  await placeOrder(c.slug, twoItems(c), { customer_name: 'Polled' });
  await expect(page.getByText('Polled').filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });

  link.restore();
  await expect(page.getByRole('alert').filter({ hasText: /Offline/ })).toHaveCount(0, { timeout: 20_000 });
});
