// Every screen, phone and desktop: renders, no runtime errors or CSP
// violations, and nothing wider than the screen (no sideways scrolling).
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, placeOrder, watchPage, adminToken, q } = require('../support');

const OWNER_PAGES = ['dashboard', 'orders', 'waiter', 'messages', 'kitchen', 'reservations', 'tables', 'waitlist', 'shift',
  'menu', 'inventory', 'modifiers', 'schedule', 'offers', 'ratings', 'analytics', 'customers', 'loyalty',
  'staff', 'billing', 'help', 'profile'];

async function overflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const page = document.scrollingElement.scrollWidth - vw;
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || r.right <= vw + 1) return false;
        // ignore content inside a horizontal scroller (chip rows, tables)
        for (let p = el.parentElement; p; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if ((ox === 'auto' || ox === 'scroll' || ox === 'hidden') && p.getBoundingClientRect().right <= vw + 1) return false;
        }
        return getComputedStyle(el).position !== 'fixed' || r.left < vw;
      })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} → ${Math.round(el.getBoundingClientRect().right)}px`);
    return { page, wide };
  });
}

test('owner screens', async ({ page }) => {
  test.setTimeout(180_000);
  const c = await seedCafe();
  await placeOrder(c.slug, [c.item['Paneer Tikka'].id], { table_token: c.tables['1'].qr_token });
  const problems = watchPage(page);
  await signIn(page, c.cafe.email);
  const bad = [];
  for (const p of OWNER_PAGES) {
    await page.goto(`/owner/${p}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main, [role=main]').first(), p).toBeVisible();
    if (await page.getByText(/Something went wrong/i).count()) bad.push(`${p}: error boundary`);
    const o = await overflow(page);
    if (o.page > 1 || o.wide.length) bad.push(`${p}: overflow ${o.page}px ${o.wide.join(', ')}`);
  }
  expect(bad).toEqual([]);
  expect(problems).toEqual([]);
});

test('public and customer screens', async ({ page }) => {
  test.setTimeout(120_000);
  const c = await seedCafe();
  const problems = watchPage(page);
  const bad = [];
  const check = async (label) => {
    await page.waitForLoadState('networkidle');
    if (await page.getByText(/Something went wrong/i).count()) bad.push(`${label}: error boundary`);
    const o = await overflow(page);
    if (o.page > 1 || o.wide.length) bad.push(`${label}: overflow ${o.page}px ${o.wide.join(', ')}`);
  };
  for (const p of ['/', '/explore', '/terms', '/privacy', '/refund', '/contact', '/owner/login', '/owner/register', '/rider/login', '/admin/login', '/no-such-page']) {
    await page.goto(p);
    await check(p);
  }
  await page.goto(`/cafe/${c.slug}?table=1&t=${c.tables['1'].qr_token}`);
  await check('entry');
  await page.getByRole('button', { name: 'View Menu →' }).click();
  await check('menu');
  await page.getByRole('button', { name: /^ADD / }).first().click();
  await page.getByRole('button', { name: /View Cart/ }).click();
  await check('cart');
  await page.getByRole('textbox', { name: 'Your name *' }).fill('Asha');
  await page.getByRole('textbox', { name: 'Mobile number *' }).fill('9876543210');
  await page.getByRole('button', { name: /^Place Order/ }).click();
  await page.getByRole('button', { name: 'Yes, Place Order' }).click();
  await page.waitForURL(/confirmation/);
  await check('confirmation');
  await page.goto(`/cafe/${c.slug}/my-orders`);
  await check('my-orders');
  expect(bad).toEqual([]);
  expect(problems).toEqual([]);
});

test('admin screens', async ({ page }) => {
  const problems = watchPage(page);
  const [dev] = await q(
    `INSERT INTO developers (name, email, password_hash) VALUES ('E2E Admin', $1, 'x') RETURNING id`,
    [`admin-${Date.now()}-${Math.random()}@t.com`]
  );
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('dineverse_admin_token', t), adminToken(dev.id));
  const bad = [];
  for (const p of ['dashboard', 'cafes', 'revenue', 'tickets', 'analytics', 'offers', 'settings']) {
    await page.goto(`/admin/${p}`);
    await page.waitForLoadState('networkidle');
    await expect(page, p).toHaveURL(new RegExp(`/admin/${p}`));
    if (await page.getByText(/Something went wrong/i).count()) bad.push(`${p}: error boundary`);
    const o = await overflow(page);
    if (o.page > 1 || o.wide.length) bad.push(`${p}: overflow ${o.page}px ${o.wide.join(', ')}`);
  }
  await page.goto('/admin/settings');
  await expect(page.getByRole('switch', { name: 'Online payments for customers' })).toHaveAttribute('aria-checked', 'false');
  expect(bad).toEqual([]);
  expect(problems).toEqual([]);
});
