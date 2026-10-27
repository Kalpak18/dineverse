// Playwright `test` with app-level defaults: first-visit tours dismissed,
// sound muted, a fake GPS position in Pune (near the seeded cafés).
const base = require('@playwright/test');

const test = base.test.extend({
  context: async ({ context }, use) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 18.5314, longitude: 73.8446 }); // ≈0.3 km from the café
    await context.addInitScript(() => {
      try {
        localStorage.setItem('dineverse_customer_tour_done', '1');
        localStorage.setItem('dineverse_announcement_dismissed', '1');
        localStorage.setItem('dv_sound', 'off');
      } catch { /* opaque origin */ }
    });
    await use(context);
  },
});

module.exports = { test, expect: base.expect };
