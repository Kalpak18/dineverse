// Kitchen, orders and billing screens driven by staff, incl. printing under the CSP.
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, login, placeOrder, advance, q } = require('../support');

const twoItems = (c) => [c.item['Paneer Tikka'].id, c.item['Cold Coffee'].id];

// window.print never opens a dialog in tests; count calls instead
async function stubPrint(page) {
  await page.addInitScript(() => {
    const open = window.open;
    window.__printed = 0;
    window.open = function (...a) {
      const w = open.apply(window, a);
      if (w) w.print = () => { window.__printed += 1; };
      return w;
    };
  });
}

test('kitchen Lanes: start cooking, recall, station filter', async ({ page }) => {
  const c = await seedCafe();
  const order = (await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token })).order;
  await signIn(page, c.cafe.email);
  await page.goto('/owner/kitchen');

  // Phones show one lane at a time behind tabs; wide screens show all three
  const lane = (name) => page.getByRole('region', { name: `${name} orders` });
  const show = async (name) => {
    const tab = page.getByRole('button', { name: new RegExp(`^${name} \\d+$`) });
    if (await tab.isVisible()) await tab.click();
    return lane(name);
  };
  await expect(await show('New')).toContainText('#01');
  await lane('New').getByRole('button', { name: /#01/ }).click();
  await expect(await show('Cooking')).toContainText('#01');
  await expect.poll(async () => (await q('SELECT status FROM orders WHERE id = $1', [order.id]))[0].status).toBe('preparing');

  await page.getByRole('button', { name: 'Recall' }).click();
  await expect(await show('New')).toContainText('#01');

  // On the bar screen only drinks can be ticked off; kitchen lines are dimmed
  await page.getByRole('combobox', { name: 'Kitchen station' }).selectOption({ label: 'Bar' });
  const ticket = (await show('New')).getByRole('article');
  await expect(ticket.getByRole('button', { name: /Cold Coffee/ })).toBeEnabled();
  await expect(ticket.getByRole('button', { name: /Paneer Tikka/ })).toBeDisabled();
});

test('kitchen screen picks up a new order live', async ({ page }) => {
  const c = await seedCafe();
  await signIn(page, c.cafe.email);
  await page.goto('/owner/kitchen');
  await expect(page.getByRole('region', { name: 'New orders' })).toContainText('No tickets');
  await placeOrder(c.slug, twoItems(c), { table_token: c.tables['2'].qr_token });
  await expect(page.getByRole('region', { name: 'New orders' })).toContainText('Table 2');
});

test('KOT and bill print pop-ups render and print under the CSP', async ({ page, context }) => {
  const c = await seedCafe();
  await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token });
  await stubPrint(page);
  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');

  const cspErrors = [];
  context.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text()); });

  const [kot] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: '📋 KOT' }).click()]);
  await expect(kot.locator('body')).toContainText('Paneer Tikka');
  await kot.getByRole('button', { name: 'PRINT KOT' }).click(); // wired from the app, not an inline handler
  await expect.poll(() => page.evaluate(() => window.__printed)).toBeGreaterThanOrEqual(1);

  await page.getByRole('button', { name: '🖨️ Bill' }).click(); // opens the billing sheet
  const [bill] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: '🖨️ Print Draft Bill' }).click()]);
  await expect(bill.locator('body')).toContainText('346.80');
  await expect.poll(() => page.evaluate(() => window.__printed)).toBeGreaterThanOrEqual(2);
  expect(cspErrors).toEqual([]);
});

test('split bill: shares must add up, then the table is paid with the split recorded', async ({ page }) => {
  const c = await seedCafe();
  const { token } = await login(c.cafe.email);
  const o = (await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token })).order;
  await advance(token, o.id, 'served');

  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');
  await page.getByRole('button', { name: /^Bills/ }).click();
  await page.getByRole('button', { name: '💵 Collect Payment' }).click();
  await page.getByRole('button', { name: '➗ Split bill' }).click();
  await expect(page.getByText(/Shares add up to/)).toBeVisible(); // equal split by default

  // Uneven shares that don't add up block payment
  await page.getByRole('spinbutton', { name: 'Share 1 amount' }).fill('100');
  await expect(page.getByText(/must equal/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Paid' })).toBeDisabled();

  const share2 = await page.getByRole('spinbutton', { name: 'Share 2 amount' }).inputValue();
  await page.getByRole('spinbutton', { name: 'Share 2 amount' }).fill(String((346.8 - 100).toFixed(2)));
  await page.getByRole('combobox', { name: 'Share 2 payment mode' }).selectOption('upi');
  expect(share2).not.toBe('');
  await page.getByRole('button', { name: 'Mark Paid' }).click();

  await expect.poll(async () => (await q('SELECT status, payment_mode FROM orders WHERE id = $1', [o.id]))[0])
    .toEqual({ status: 'paid', payment_mode: 'split' });
  const [{ payment_splits: splits }] = await q('SELECT payment_splits FROM orders WHERE id = $1', [o.id]);
  expect(splits).toEqual([{ amount: 100, mode: 'cash' }, { amount: 246.8, mode: 'upi' }]);
});

test('staff move an order to another table', async ({ page }) => {
  const c = await seedCafe();
  const o = (await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token })).order;
  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');
  await page.getByRole('button', { name: 'Move table' }).click();
  await page.getByRole('button', { name: /^(Table )?3$/ }).click();
  await expect.poll(async () => (await q('SELECT table_number FROM orders WHERE id = $1', [o.id]))[0].table_number).toBe('Table 3');
  await expect(page.getByText(/Table 3/).filter({ visible: true }).first()).toBeVisible();
});
