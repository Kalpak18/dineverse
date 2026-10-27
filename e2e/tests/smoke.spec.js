const { test, expect } = require('../fixtures');
const { seedCafe, watchPage } = require('../support');

test('landing and café pages load under the production CSP', async ({ page }) => {
  const problems = watchPage(page);
  const { slug } = await seedCafe();
  await page.goto('/');
  await expect(page.locator('body')).toContainText(/DineVerse/i);
  await page.goto(`/cafe/${slug}`);
  await expect(page.getByText('Spice Route').first()).toBeVisible();
  expect(problems).toEqual([]);
});
