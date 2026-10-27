// Customer journeys through the real UI, with the owner watching live.
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, login, orderViaUi, advance, q, watchPage } = require('../support');

test('QR dine-in order reaches the owner live and status flows back to the customer', async ({ page, browser }) => {
  const problems = watchPage(page);
  const c = await seedCafe();

  // Owner has the orders screen open on another device
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signIn(owner, c.cafe.email);
  await owner.goto('/owner/orders');
  await expect(owner.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();

  const order = await orderViaUi(page, c, { items: ['Paneer Tikka', 'Cold Coffee'] });
  await expect(page.getByRole('heading', { name: 'Order Placed!' })).toBeVisible();
  await expect(page.getByText('#01').first()).toBeVisible();
  expect(order.table_number).toBe('Table 1');
  expect(order.table_verified).toBe(true);
  expect(Number(order.total_amount)).toBe(340);

  // Arrives on the owner's screen without a refresh
  await expect(owner.getByText('Asha').filter({ visible: true }).first()).toBeVisible();
  await owner.getByRole('button', { name: 'Accept Order' }).click();

  // …and the customer's status changes without a refresh
  await expect(page.getByText('Accepted').first()).toBeVisible();
  const { token } = await login(c.cafe.email);
  await advance(token, order.id, 'ready');
  await expect(page.getByText('Ready!').first()).toBeVisible();

  expect(problems).toEqual([]);
  await ownerCtx.close();
});

test('takeaway order needs no table', async ({ page }) => {
  const c = await seedCafe();
  const order = await orderViaUi(page, c, { type: 'takeaway', items: ['Chicken Biryani'] });
  expect(order.order_type).toBe('takeaway');
  expect(order.table_number).toBe('Takeaway');
  await expect(page.getByRole('heading', { name: 'Order Placed!' })).toBeVisible();
});

test('menu switches to Hindi and the choice sticks', async ({ page }) => {
  const c = await seedCafe();
  await page.goto(`/cafe/${c.slug}?table=1&t=${c.tables['1'].qr_token}`);
  await page.getByRole('combobox', { name: 'Language' }).selectOption({ label: 'हिन्दी' });
  await expect(page.getByRole('button', { name: '📅 पहले से टेबल बुक करें' })).toBeVisible();
  await expect(page.getByRole('navigation').getByText('बुकिंग')).toBeVisible();
  await page.getByRole('button', { name: 'मेन्यू देखें →' }).click();
  await expect(page.getByRole('button', { name: /शुद्ध शाकाहारी/ })).toBeVisible();
  await page.getByRole('textbox').first().fill('पनीर');
  await expect(page.getByText('पनीर टिक्का').first()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /मुख्य व्यंजन/ }).click();
  await expect(page.getByText('पनीर टिक्का').first()).toBeVisible();
});

test('item details sheet opens from an empty cart and adds to cart', async ({ page }) => {
  const c = await seedCafe();
  await page.goto(`/cafe/${c.slug}?table=1&t=${c.tables['1'].qr_token}`);
  await page.getByRole('button', { name: 'View Menu →' }).click();
  await page.getByRole('textbox', { name: /Search dishes/ }).fill('Paneer');
  await page.getByRole('button', { name: /^Paneer Tikka Smoky/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Smoky cottage cheese from the tandoor');
  await sheet.getByRole('button', { name: /add/i }).first().click();
  await expect(page.getByRole('button', { name: /View Cart/ })).toContainText('₹220');
});

test('cart survives a reload and quantities/totals stay consistent', async ({ page }) => {
  const c = await seedCafe();
  await page.goto(`/cafe/${c.slug}?table=1&t=${c.tables['1'].qr_token}`);
  await page.getByRole('button', { name: 'View Menu →' }).click();
  await page.getByRole('textbox', { name: /Search dishes/ }).fill('Cold');
  await page.getByRole('button', { name: 'ADD Cold Coffee' }).click();
  await page.getByRole('button', { name: 'Add one more' }).click();
  await page.getByRole('button', { name: 'Add one more' }).click();
  await expect(page.getByRole('button', { name: /View Cart/ })).toContainText('₹360');
  await page.reload();
  await expect(page.getByRole('button', { name: /View Cart/ })).toContainText('₹360');
  await page.getByRole('button', { name: /View Cart/ }).click();
  await page.getByRole('button', { name: 'Remove one' }).click();
  await expect(page.getByText(/Total amount due\s*₹244\.80/)).toBeVisible(); // 240 + 2% platform
});

test('call waiter and request bill reach floor staff live', async ({ page, browser }) => {
  const c = await seedCafe({ staff: ['waiter'] });
  await orderViaUi(page, c);

  const staffCtx = await browser.newContext();
  const waiter = await staffCtx.newPage();
  await signIn(waiter, c.staff.waiter.email);
  await waiter.goto('/owner/waiter');
  const panel = waiter.getByRole('region', { name: 'Table requests' });

  await page.getByRole('button', { name: '🙋 Call waiter' }).click();
  await expect(panel).toContainText('Calling a waiter');
  await expect(panel).toContainText('Table 1');
  await page.getByRole('button', { name: '🧾 Request bill' }).click();
  await expect(panel).toContainText('Wants the bill');

  await panel.getByRole('button', { name: 'On my way' }).first().click();
  await expect(panel.getByRole('button', { name: 'On my way' })).toHaveCount(1);
  const open = await q(`SELECT count(*)::int AS n FROM service_requests WHERE cafe_id = $1 AND acknowledged_at IS NULL`, [c.cafe.id]);
  expect(open[0].n).toBe(1);
  await staffCtx.close();
});

test('a link without the QR secret places an unverified order that staff must confirm', async ({ page, browser }) => {
  const c = await seedCafe();
  const order = await orderViaUi(page, c, { qr: false, table: '2' });
  expect(order.table_verified).toBe(false);

  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signIn(owner, c.cafe.email);
  await owner.goto('/owner/orders');
  await owner.getByRole('button', { name: 'Confirm table' }).click();
  await owner.getByRole('button', { name: /^(Table )?2$/ }).click();
  await expect.poll(async () => (await q('SELECT table_verified FROM orders WHERE id = $1', [order.id]))[0].table_verified).toBe(true);
  await ownerCtx.close();
});
