// Kitchen, orders and billing screens driven by staff, incl. printing under the CSP.
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, login, placeOrder, advance, q } = require('../support');

const twoItems = (c) => [c.item['Paneer Tikka'].id, c.item['Cold Coffee'].id];

// Printing happens in the page itself (no pop-up window). Tests don't open a
// real dialog: they count print() calls and read what was laid out to print.
async function stubPrint(page) {
  await page.addInitScript(() => {
    window.__printed = 0;
    window.print = () => { window.__printed += 1; };
  });
}
const printout = (page) => page.locator('#dv-print-root');

test('kitchen Lanes: start cooking, recall, station filter', async ({ page }) => {
  const c = await seedCafe();
  const order = (await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token })).order;
  await signIn(page, c.cafe.email);
  await page.goto('/owner/kitchen');
  await page.getByRole('button', { name: 'Lanes view' }).click(); // By Table is the default

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
  await page.getByRole('button', { name: 'Lanes view' }).click();
  await expect(page.getByRole('region', { name: 'New orders' })).toContainText('No tickets');
  await placeOrder(c.slug, twoItems(c), { table_token: c.tables['2'].qr_token });
  await expect(page.getByRole('region', { name: 'New orders' })).toContainText('Table 2');
});

test('KOT and bill open an in-app preview: Print, WhatsApp, Back/Close stay in the app', async ({ page, context }) => {
  const c = await seedCafe();
  await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token, customer_phone: '9876543210' });
  await stubPrint(page);
  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');

  const cspErrors = [];
  let popups = 0;
  context.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text()); });
  context.on('page', () => { popups += 1; });

  // KOT: preview first, nothing printed until asked
  await page.getByRole('button', { name: '📋 KOT' }).click();
  const kot = page.getByRole('dialog', { name: 'KOT preview' });
  await expect(kot).toBeVisible();
  await expect(kot.frameLocator('iframe').locator('body')).toContainText('Paneer Tikka');
  expect(await page.evaluate(() => window.__printed)).toBe(0);
  await kot.getByRole('button', { name: '🖨️ Print' }).click();
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);
  await expect(printout(page)).toContainText('Paneer Tikka');
  await expect(printout(page)).toBeHidden(); // only on paper, never on screen

  // The phone's Back button closes the preview and stays on Orders
  await page.goBack();
  await expect(kot).toBeHidden();
  await expect(page).toHaveURL(/\/owner\/orders/);

  // Bill: café is the headline; WhatsApp carries the bill text
  await page.getByRole('button', { name: '💵 Bill / Pay' }).click(); // opens the billing sheet
  await page.getByRole('button', { name: '🖨️ Print Draft Bill' }).click();
  const bill = page.getByRole('dialog', { name: 'Bill preview' });
  const doc = bill.frameLocator('iframe');
  await expect(doc.locator('.cafe-name')).toHaveText('Spice Route');
  await expect(doc.locator('body')).toContainText(/Order\s*#1 · Table 1/);
  await expect(doc.locator('body')).toContainText(/Platform charge \(2%\)\s*₹6\.80/); // lines add up
  await expect(doc.locator('body')).not.toContainText('ORDER TOKEN');
  const wa = await bill.getByRole('link', { name: /WhatsApp/ }).getAttribute('href');
  expect(wa).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
  expect(decodeURIComponent(wa)).toContain('Total ₹346.80');
  await bill.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(bill).toBeHidden();
  await expect(page).toHaveURL(/\/owner\/orders/);
  expect(await page.evaluate(() => window.__printed)).toBe(1); // Close never prints

  expect(popups).toBe(0);
  expect(cspErrors).toEqual([]);
});

test('kitchen: a mistaken "Served" can be undone (toast and toolbar)', async ({ page }) => {
  const c = await seedCafe();
  const { token } = await login(c.cafe.email);
  const a = (await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token, customer_name: 'Asha' })).order;
  const b = (await placeOrder(c.slug, twoItems(c), { table_token: c.tables['2'].qr_token, customer_name: 'Ravi' })).order;
  await advance(token, a.id, 'ready');
  await advance(token, b.id, 'ready');
  const status = async (id) => (await q('SELECT status FROM orders WHERE id = $1', [id]))[0].status;

  await signIn(page, c.cafe.email);
  await page.goto('/owner/kitchen'); // By Table is the default view
  await expect(page.getByRole('button', { name: 'By Table view' })).toHaveAttribute('aria-pressed', 'true');

  const asha = page.getByText('Asha').filter({ visible: true }).first();
  await expect(asha).toBeVisible();
  await page.getByRole('button', { name: 'Mark as Served →' }).first().click();
  await expect.poll(() => Promise.all([status(a.id), status(b.id)])).toContain('served');
  const servedId = (await status(a.id)) === 'served' ? a.id : b.id;

  // Undo from the toast
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => status(servedId)).toBe('ready');
  await expect(page.getByText(servedId === a.id ? 'Asha' : 'Ravi').filter({ visible: true }).first()).toBeVisible();

  // …or later from the toolbar, after the toast has gone
  await page.getByRole('button', { name: 'Mark as Served →' }).first().click();
  await expect.poll(() => Promise.all([status(a.id), status(b.id)])).toContain('served');
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect.poll(() => Promise.all([status(a.id), status(b.id)])).toEqual(['ready', 'ready']);
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
