// End-to-end tests against the production frontend build (served with the
// real vercel.json headers/CSP), the real API and a throwaway Postgres DB.
// Razorpay is stubbed in the API process; everything else is real.
//
//   cd e2e && npx playwright test            (TEST_PG_URL → a Postgres you can CREATE DATABASE on)
const { defineConfig, devices } = require('@playwright/test');

const WEB_PORT = Number(process.env.E2E_WEB_PORT || 4610);

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block', // the PWA service worker would cache between tests
  },
  // Counter-only payments are the default. The online-payment tests flip the
  // platform switch on, so they run as a second phase once everything else
  // has finished.
  projects: [
    { name: 'phone',   testIgnore: /payments\.spec/, use: { ...devices['Pixel 7'] } },
    { name: 'desktop', testIgnore: /payments\.spec/, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'online-phone',   testMatch: /payments\.spec/, dependencies: ['phone', 'desktop'], use: { ...devices['Pixel 7'] } },
    { name: 'online-desktop', testMatch: /payments\.spec/, dependencies: ['phone', 'desktop'], use: { viewport: { width: 1440, height: 900 } } },
  ],
});
