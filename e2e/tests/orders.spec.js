// The manager's Orders tab: every status change, bill and payment must be
// exact and must never be silently lost.
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, login, placeOrder, advance, api, q } = require('../support');

const row = async (id) => (await q(
  'SELECT status, payment_mode, cash_received::float, change_amount::float, final_amount::float FROM orders WHERE id = $1', [id]))[0];

async function openBills(page, email) {
  await page.addInitScript(() => { window.print = () => {}; });
  await signIn(page, email);
  await page.goto('/owner/orders');
  await page.getByRole('button', { name: /^Bills/ }).click();
}

test('takeaway paid at pickup is really recorded (was shown as collected, never saved)', async ({ page }) => {
  const c = await seedCafe();
  const { token } = await login(c.cafe.email);
  const { order } = await placeOrder(c.slug, [c.item['Chicken Biryani'].id], { order_type: 'takeaway', table_number: undefined });
  await advance(token, order.id, 'ready');

  await openBills(page, c.cafe.email);
  await page.getByRole('button', { name: '💵 Collect Payment' }).click();
  await page.getByRole('button', { name: 'Mark Paid' }).click();
  await expect(page.getByRole('heading', { name: 'Payment Collected!' })).toBeVisible();
  await expect.poll(async () => (await row(order.id)).status).toBe('paid');
});

test('a refused payment keeps the bill open and never says "collected"', async ({ page }) => {
  const c = await seedCafe();
  const { token } = await login(c.cafe.email);
  const { order } = await placeOrder(c.slug, [c.item['Cold Coffee'].id], { table_token: c.tables['1'].qr_token });
  await advance(token, order.id, 'served');

  await openBills(page, c.cafe.email);
  await page.route('**/api/orders/*/payment', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"success":false,"message":"nope"}' }));
  await page.getByRole('button', { name: '💵 Collect Payment' }).click();
  await page.getByRole('button', { name: 'Mark Paid' }).click();
  await expect(page.getByText(/Already changed on another device/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment Collected!' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark Paid' })).toBeVisible(); // still there to retry
  expect((await row(order.id)).status).toBe('served');
});

test('table bill: two rounds billed together, change worked out on the whole bill', async ({ page }) => {
  const c = await seedCafe();
  const { token } = await login(c.cafe.email);
  const a = (await placeOrder(c.slug, [c.item['Paneer Tikka'].id], { table_token: c.tables['2'].qr_token })).order;  // 224.40
  const b = (await placeOrder(c.slug, [c.item['Cold Coffee'].id], { table_token: c.tables['2'].qr_token })).order;   // 122.40
  await advance(token, a.id, 'served');
  await advance(token, b.id, 'served');

  await openBills(page, c.cafe.email);
  await page.getByRole('button', { name: '💵 Collect Payment' }).click();
  await expect(page.getByText('₹346.80').first()).toBeVisible();
  await page.getByRole('spinbutton').first().fill('500');
  await page.getByRole('button', { name: /Confirm & Mark Paid/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment Collected!' })).toBeVisible();
  const [ra, rb] = [await row(a.id), await row(b.id)];
  expect([ra.status, rb.status]).toEqual(['paid', 'paid']);
  const withCash = [ra, rb].find((r) => r.cash_received);
  expect(withCash.cash_received).toBe(500);
  expect(withCash.change_amount).toBeCloseTo(153.2, 2); // 500 − 346.80, not 500 − one round
});

test('a prepaid round is never billed again at the table', async ({ page }) => {
  const c = await seedCafe();
  const { token } = await login(c.cafe.email);
  const paidOnline = (await placeOrder(c.slug, [c.item['Paneer Tikka'].id], { table_token: c.tables['3'].qr_token })).order;
  const counter = (await placeOrder(c.slug, [c.item['Cold Coffee'].id], { table_token: c.tables['3'].qr_token })).order;
  await q(`UPDATE orders SET payment_verified = true, payment_mode = 'online' WHERE id = $1`, [paidOnline.id]);
  await advance(token, paidOnline.id, 'served');
  await advance(token, counter.id, 'served');

  await openBills(page, c.cafe.email);
  await page.getByRole('button', { name: '💵 Collect Payment' }).click();
  await expect(page.getByText('₹122.40').first()).toBeVisible();   // only the unpaid round
  await expect(page.getByText('₹346.80')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark Paid' }).click();
  await expect(page.getByRole('heading', { name: 'Payment Collected!' })).toBeVisible();
  await expect.poll(async () => (await row(counter.id)).status).toBe('paid');
  expect((await row(paidOnline.id)).payment_mode).toBe('online'); // not overwritten with "cash"
});

test('an old unpaid order is still on the bills, and a cancelled item is not charged', async ({ page }) => {
  const c = await seedCafe();
  const { token } = await login(c.cafe.email);
  const { order } = await placeOrder(c.slug, [c.item['Paneer Tikka'].id, c.item['Cold Coffee'].id], { table_token: c.tables['1'].qr_token });
  await advance(token, order.id, 'preparing');
  const [coffee] = await q(`SELECT id FROM order_items WHERE order_id = $1 AND item_name = 'Cold Coffee'`, [order.id]);
  expect((await api('PATCH', `/orders/${order.id}/items/${coffee.id}/cancel`, { token, body: { reason: 'Machine down' } })).status).toBe(200);
  await advance(token, order.id, 'served');
  await q(`UPDATE orders SET created_at = NOW() - INTERVAL '30 hours' WHERE id = $1`, [order.id]); // yesterday's table

  await openBills(page, c.cafe.email);
  await page.getByRole('button', { name: '💵 Collect Payment' }).click();
  await expect(page.getByText('₹224.40').first()).toBeVisible(); // Paneer only (220 + 2%)
  await expect(page.getByText('₹346.80')).toHaveCount(0);
});

test('accepting an order during a network blip still lands', async ({ page }) => {
  const c = await seedCafe();
  const { order } = await placeOrder(c.slug, [c.item['Cold Coffee'].id], { table_token: c.tables['1'].qr_token });
  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');
  let failures = 2;
  await page.route('**/api/orders/*/status', (r) => (failures-- > 0 ? r.abort('internetdisconnected') : r.continue()));
  await page.getByRole('button', { name: 'Accept Order' }).click();
  await expect.poll(async () => (await row(order.id)).status, { timeout: 15_000 }).toBe('confirmed');
});

test('History shows paid orders from earlier days with the right revenue', async ({ page }) => {
  const c = await seedCafe();
  const { token } = await login(c.cafe.email);
  const old = (await placeOrder(c.slug, [c.item['Cold Coffee'].id], { table_token: c.tables['1'].qr_token })).order;
  await advance(token, old.id, 'served');
  expect((await api('PATCH', `/orders/${old.id}/status`, { token, body: { status: 'paid', payment_mode: 'upi' } })).status).toBe(200);
  await q(`UPDATE orders SET created_at = NOW() - INTERVAL '3 days' WHERE id = $1`, [old.id]);

  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');
  await page.getByRole('button', { name: /^History/ }).click();
  await page.getByRole('button', { name: /7 days|Last 7/i }).click();
  await expect(page.getByText(/1 order · Revenue: ₹122\.40/)).toBeVisible();
});
