// Online payment from the customer's phone. Razorpay's checkout.js is
// replaced by a stand-in that signs payments like Razorpay would; the API
// talks to the Razorpay stub. Everything between them is real.
const { test, expect } = require('../fixtures');
const { seedCafe, login, orderViaUi, advance, webhook, fakeRazorpay, rzpCalls, q, setOnlinePayments } = require('../support');

test.beforeAll(() => setOnlinePayments(true)); // runs after the counter-only phase

async function servedOrder(page) {
  const c = await seedCafe({ route: true });
  const order = await orderViaUi(page, c, { items: ['Paneer Tikka', 'Cold Coffee'] });
  const { token } = await login(c.cafe.email);
  await advance(token, order.id, 'served');
  const pay = page.getByRole('button', { name: /Pay ₹346\.80 via UPI/ });
  await expect(pay).toBeVisible(); // appears live once served
  return { c, order, pay };
}
const row = async (id) => (await q('SELECT status, payment_verified, payment_id FROM orders WHERE id = $1', [id]))[0];

test('pays by UPI once served; the phone keeps showing it was paid', async ({ page }) => {
  await fakeRazorpay(page);
  const { order, pay } = await servedOrder(page);
  await pay.click();
  await expect(page.getByText('Payment successful! 🎉')).toBeVisible();
  await expect(page.getByText(/Paid online ✓/)).toBeVisible();
  await expect(pay).toBeHidden();
  const opened = await page.evaluate(() => window.__rzpOpened);
  await page.reload(); // still says so after the toast is gone
  await expect(page.getByText(/Paid online ✓/)).toBeVisible();

  expect(opened).toMatchObject({ amount: 34680, key: 'rzp_test_e2e', method: 'upi' });
  expect(await row(order.id)).toMatchObject({ status: 'served', payment_verified: true });
  const create = rzpCalls().find((x) => x.call === 'orders.create' && x.id === opened.order_id);
  expect(create.transfers).toBe(1); // the café's share is routed at creation
});

test('closing the checkout changes nothing and the customer can retry', async ({ page }) => {
  await fakeRazorpay(page, 'dismiss');
  const { order, pay } = await servedOrder(page);
  await pay.click();
  await expect(pay).toBeEnabled();
  expect(await row(order.id)).toMatchObject({ status: 'served', payment_verified: false });
});

test('signal lost after paying: the webhook settles it and the phone catches up', async ({ page }) => {
  await fakeRazorpay(page);
  const { order, pay } = await servedOrder(page);
  await page.route('**/pay/verify', (r) => r.abort('internetdisconnected'));
  await pay.click();
  await expect(page.getByText('Confirming your payment…')).toBeVisible();
  expect((await row(order.id)).payment_verified).toBe(false);

  const { order_id, amount } = await page.evaluate(() => window.__rzpOpened);
  const hook = await webhook({ event: 'payment.captured', payload: { payment: { entity: {
    id: order_id.replace('order_', 'pay_'), order_id, amount, notes: {} } } } });
  expect(hook.status).toBe(200);
  await expect(page.getByText('Payment successful! 🎉')).toBeVisible({ timeout: 15_000 });
  expect(await row(order.id)).toMatchObject({ payment_verified: true });
});

test('checkout script blocked (ad-blocker / bad network) is reported, not a crash', async ({ page }) => {
  await page.route('https://checkout.razorpay.com/**', (r) => r.abort('blockedbyclient'));
  const { order, pay } = await servedOrder(page);
  await pay.click();
  await expect(page.getByText('Payment service unavailable. Please try again.')).toBeVisible();
  expect((await row(order.id)).payment_verified).toBe(false);
});

test('a forged signature is rejected and nothing is marked paid', async ({ page }) => {
  await page.exposeFunction('__rzpSign', () => 'f'.repeat(64));
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `window.Razorpay = function (o) { this.on = function () {}; this.open = async function () {
      o.handler({ razorpay_order_id: o.order_id, razorpay_payment_id: 'pay_forged', razorpay_signature: await window.__rzpSign() }); }; };`,
  }));
  const { order, pay } = await servedOrder(page);
  await pay.click();
  await expect(page.getByText(/could not be verified|verification failed|invalid/i).first()).toBeVisible();
  expect(await row(order.id)).toMatchObject({ status: 'served', payment_verified: false });
});
