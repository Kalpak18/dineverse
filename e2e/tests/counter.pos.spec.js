// Counter / POS on the Orders tab: staff take orders, payment at any time,
// items added after paying, refunds.
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, login, api, q } = require('../support');

const orderRow = async (where, params) => (await q(
  `SELECT id, status, source, added_to_order_id, amount_paid::float, final_amount::float, payment_mode, daily_order_number
     FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT 1`, params))[0];

async function openPad(page) {
  await page.getByRole('button', { name: '＋ New order' }).click();
  return page.getByRole('dialog', { name: 'New order' });
}
async function addDish(pad, name) {
  await pad.getByRole('textbox', { name: 'Search menu' }).fill(name);
  await pad.getByRole('button', { name: `Add ${name}` }).click();
}

test('walk-in takeaway pays first, keeps cooking, then more items are added and paid separately', async ({ page }) => {
  const c = await seedCafe();
  await page.addInitScript(() => { window.print = () => {}; });
  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');

  const pad = await openPad(page);
  await addDish(pad, 'Cold Coffee');
  await pad.getByRole('button', { name: 'One more Cold Coffee' }).click();
  await pad.getByRole('textbox', { name: 'Customer name' }).fill('Ravi');
  await pad.getByRole('button', { name: 'Place & take payment' }).click();
  await page.getByRole('button', { name: 'Mark Paid' }).click();
  await expect(page.getByRole('heading', { name: 'Payment Collected!' })).toBeVisible();

  let first = await orderRow('cafe_id = $1', [c.cafe.id]);
  expect(first).toMatchObject({ status: 'confirmed', source: 'staff', amount_paid: 244.8, final_amount: 244.8 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Close|Done/ }).last().click().catch(() => {});

  // Still on the Orders tab for the kitchen, marked paid
  const card = page.locator('div', { hasText: 'Ravi' }).filter({ has: page.getByRole('button', { name: /Add items/ }) }).last();
  await expect(card.getByText(/✓ Paid · Cash/)).toBeVisible();

  // More items after paying → a new round, due on its own
  await card.getByRole('button', { name: /Add items/ }).click();
  const add = page.getByRole('dialog', { name: 'Add items' });
  await addDish(add, 'Paneer Tikka');
  await add.getByRole('button', { name: 'Send to kitchen' }).click();
  await expect(page.getByText(/➕ Added to TK/).first()).toBeVisible();
  const round = await orderRow('added_to_order_id = $1', [first.id]);
  expect(round).toMatchObject({ status: 'confirmed', amount_paid: 0, final_amount: 224.4 });
  first = await orderRow('id = $1', [first.id]);
  expect(first.amount_paid).toBe(244.8); // the paid order is untouched
});

test('an item cancelled after paying asks staff to refund the difference', async ({ page }) => {
  const c = await seedCafe();
  const { token } = await login(c.cafe.email);
  const created = await api('POST', '/orders/staff', { token, body: { order_type: 'takeaway', customer_name: 'Meera',
    items: [{ menu_item_id: c.item['Paneer Tikka'].id, quantity: 1 }, { menu_item_id: c.item['Cold Coffee'].id, quantity: 1 }] } });
  const id = created.body.order.id;
  await api('POST', `/orders/${id}/payment`, { token, body: { payment_mode: 'cash' } });
  const coffee = created.body.order.items.find((i) => i.item_name === 'Cold Coffee');
  await api('PATCH', `/orders/${id}/items/${coffee.id}/cancel`, { token, body: { reason: 'Machine down' } });

  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');
  const alert = page.getByRole('alert').filter({ hasText: /Refund ₹122\.40/ });
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'Refunded' }).click();
  await expect(alert).toHaveCount(0);
  expect((await orderRow('id = $1', [id])).amount_paid).toBe(224.4);
});

test('dine-in counter order goes to the chosen table; a dish with sizes asks for one', async ({ page }) => {
  const c = await seedCafe();
  await q(`INSERT INTO item_variants (item_id, name, price, sort_order) VALUES ($1, 'Half', 180, 0), ($1, 'Full', 280, 1)`, [c.item['Chicken Biryani'].id]);
  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');

  const pad = await openPad(page);
  await pad.getByRole('button', { name: '🍽️ Dine-in' }).click();
  await pad.getByRole('combobox', { name: 'Table' }).selectOption({ label: 'Table 2' });
  await addDish(pad, 'Chicken Biryani');
  const sizes = page.getByRole('dialog', { name: 'Chicken Biryani options' });
  await sizes.getByText('Half').click();
  await sizes.getByRole('button', { name: 'Add' }).click();
  await expect(pad.getByRole('list', { name: 'Order lines' })).toContainText('Chicken Biryani (Half)');
  await pad.getByRole('button', { name: 'Place order' }).click();

  await expect.poll(async () => (await orderRow('cafe_id = $1', [c.cafe.id]))?.status).toBe('confirmed');
  const o = await orderRow('cafe_id = $1', [c.cafe.id]);
  const [{ table_number: table, table_verified: verified }] = await q('SELECT table_number, table_verified FROM orders WHERE id = $1', [o.id]);
  expect(table).toBe('Table 2');
  expect(verified).toBe(true);
  expect(o.final_amount).toBe(183.6); // Half: 180 + 2%
});
