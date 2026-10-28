// Counter-only payments (the default): no online pay button for customers,
// the café collects at the counter, then remits DineVerse's platform fee by
// UPI/bank and reports it; the admin confirms it.
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, login, orderViaUi, advance, api, adminToken, q } = require('../support');

test('customer is asked to pay at the counter, never online', async ({ page }) => {
  const c = await seedCafe({ route: true }); // even with an active payout account
  const order = await orderViaUi(page, c, { items: ['Paneer Tikka'] });
  const { token } = await login(c.cafe.email);
  await advance(token, order.id, 'served');
  await expect(page.getByText(/Please pay ₹224\.40 at the counter/)).toBeVisible();
  await expect(page.getByRole('button', { name: /via UPI/ })).toHaveCount(0);
});

test('café remits the platform fee by UPI and the admin confirms it', async ({ page }) => {
  const c = await seedCafe();
  const { token } = await login(c.cafe.email);
  const order = await orderViaUi(page, c, { items: ['Chicken Biryani'] }); // ₹280 + 2% = ₹285.60
  await advance(token, order.id, 'served');
  expect((await api('PATCH', `/orders/${order.id}/status`, { token, body: { status: 'paid', payment_mode: 'upi' } })).status).toBe(200);
  expect((await q('SELECT commission_status FROM orders WHERE id = $1', [order.id]))[0].commission_status).toBe('cash_due');

  await api('PUT', '/admin/settings/remittance', {
    token: adminToken(), body: { value: { upi_id: 'dineverse@okaxis', payee_name: 'DineVerse', note: 'Remit by the 5th' } },
  });

  await signIn(page, c.cafe.email);
  await page.goto('/owner/billing');
  await expect(page.getByText('₹5.60 platform fee to remit')).toBeVisible();
  const upi = page.getByRole('link', { name: /Pay ₹5\.60 with any UPI app/ });
  const href = await upi.getAttribute('href');
  expect(href).toMatch(/^upi:\/\/pay\?/);
  expect(new URLSearchParams(href.split('?')[1]).get('am')).toBe('5.60');
  expect(new URLSearchParams(href.split('?')[1]).get('pa')).toBe('dineverse@okaxis');
  // Razorpay is configured in the test API, so card/netbanking is offered as a second option
  await expect(page.getByRole('button', { name: /by card \/ netbanking/ })).toBeVisible();

  await page.getByRole('button', { name: /I've paid/ }).click();
  await page.getByRole('textbox', { name: /reference number/ }).fill('UTR998877');
  await page.getByRole('button', { name: 'Send to DineVerse' }).click();
  await expect(page.getByText('Thanks! We will confirm your payment shortly.')).toBeVisible();
  const [ticket] = await q('SELECT subject, message FROM support_tickets WHERE cafe_id = $1', [c.cafe.id]);
  expect(ticket.subject).toContain('₹5.60');
  expect(ticket.message).toContain('UTR998877');

  const collect = await api('POST', '/admin/commission/collect', { token: adminToken(), body: { cafe_id: c.cafe.id, payment_reference: 'UTR998877' } });
  expect(collect.body.amount_collected).toBe(5.6);
  await page.reload();
  await expect(page.getByText('All platform fees remitted')).toBeVisible();
});

test('payout (Razorpay) onboarding is hidden from owners in counter mode', async ({ page }) => {
  const c = await seedCafe();
  await signIn(page, c.cafe.email);
  await page.goto('/owner/profile');
  await page.getByRole('button', { name: /Account/ }).first().click();
  await expect(page.getByText('Payout Account')).toHaveCount(0);
});
