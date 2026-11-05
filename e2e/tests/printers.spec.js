// Direct printing to receipt printers (ESC/POS) without the print screen.
// The printers are simulated in the page: we check the exact bytes sent.
const { test, expect } = require('../fixtures');
const { seedCafe, signIn, placeOrder } = require('../support');

const twoItems = (c) => [c.item['Paneer Tikka'].id, c.item['Cold Coffee'].id];

// Fake Web Serial / Web Bluetooth printers recording what they receive
async function fakePrinters(page, { printer, failSerial = false } = {}) {
  await page.addInitScript(({ printer, failSerial }) => {
    window.__bytes = [];
    window.__chunks = [];
    window.__printed = 0;
    window.print = () => { window.__printed += 1; };
    if (printer) localStorage.setItem('dv_printer', JSON.stringify(printer));
    const sink = (chunk) => { window.__chunks.push(chunk.length); window.__bytes.push(...chunk); };
    const port = {
      writable: null,
      async open() { this.writable = new WritableStream({ write: sink }); },
    };
    Object.defineProperty(navigator, 'serial', { configurable: true, value: {
      getPorts: async () => [],
      requestPort: async () => { if (failSerial) throw new Error('Printer is off'); return port; },
    } });
    const ch = { properties: { writeWithoutResponse: true }, writeValueWithoutResponse: async (c) => sink(c) };
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {
      requestDevice: async () => ({ gatt: { connected: true, connect: async () => ({
        getPrimaryServices: async () => [{ getCharacteristics: async () => [ch] }],
      }), disconnect() {} } }),
    } });
  }, { printer, failSerial });
}
// The printed text, with ESC/POS commands (whose argument bytes can look
// like letters) skipped
const printedText = (page) => page.evaluate(() => {
  const b = window.__bytes;
  let out = '';
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 0x1b) { i += b[i + 1] === 0x40 ? 1 : 2; continue; }      // ESC @ / ESC a|E|d n
    if (b[i] === 0x1d) { i += b[i + 1] === 0x56 ? 3 : 2; continue; }      // GS V m n / GS ! n
    if (b[i] === 10 || (b[i] >= 32 && b[i] < 127)) out += String.fromCharCode(b[i]);
  }
  return out;
});
const lastBytes = (page, n) => page.evaluate((n) => window.__bytes.slice(-n), n);

test('KOT goes straight to a Bluetooth-classic / serial printer on 58 mm paper', async ({ page }) => {
  const c = await seedCafe();
  await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token });
  await fakePrinters(page, { printer: { method: 'serial', width: 58, cut: true } });
  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');

  await page.getByRole('button', { name: '📋 KOT' }).click();
  const preview = page.getByRole('dialog', { name: 'KOT preview' });
  await expect(preview.getByText(/Printer: Bluetooth \(classic\) \/ USB-serial · 58 mm/)).toBeVisible();
  await preview.getByRole('button', { name: '🖨️ Print' }).click();
  await expect(page.getByText('Sent to the printer')).toBeVisible();

  const text = await printedText(page);
  expect(text).toContain('Paneer Tikka');
  expect(text).toContain('Cold Coffee');
  expect(text).toContain('KOT - SLIP #1');
  for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(32); // fits 58 mm
  expect(await lastBytes(page, 4)).toEqual([0x1d, 0x56, 0x42, 0x00]);             // paper cut
  expect(await page.evaluate(() => window.__printed)).toBe(0);                     // no print screen
});

test('bill goes to a Bluetooth (BLE) printer in small packets, ₹ as Rs.', async ({ page }) => {
  const c = await seedCafe();
  await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token });
  await fakePrinters(page, { printer: { method: 'bluetooth', width: 80, cut: false } });
  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');

  await page.getByRole('button', { name: '💵 Bill / Pay' }).click();
  await page.getByRole('button', { name: '🖨️ Print Draft Bill' }).click();
  await page.getByRole('dialog', { name: 'Bill preview' }).getByRole('button', { name: '🖨️ Print' }).click();
  await expect(page.getByText('Sent to the printer')).toBeVisible();

  const text = await printedText(page);
  expect(text).toContain('Spice Route');
  expect(text).toMatch(/TOTAL\s+Rs\.346\.80/);
  expect(text).toMatch(/Platform charge \(2%\)\s+Rs\.6\.80/);
  for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(48); // fits 80 mm
  const chunks = await page.evaluate(() => window.__chunks);
  expect(Math.max(...chunks)).toBeLessThanOrEqual(180);
  expect(await lastBytes(page, 4)).not.toEqual([0x1d, 0x56, 0x42, 0x00]); // cutting turned off
});

test('printer not reachable: clear message and one tap to the print screen', async ({ page }) => {
  const c = await seedCafe();
  await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token });
  await fakePrinters(page, { printer: { method: 'serial', width: 80 }, failSerial: true });
  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');

  await page.getByRole('button', { name: '📋 KOT' }).click();
  await page.getByRole('dialog', { name: 'KOT preview' }).getByRole('button', { name: '🖨️ Print' }).click();
  await expect(page.getByText(/Printer: Printer is off/)).toBeVisible();
  await page.getByRole('button', { name: 'Use print screen' }).click();
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);
});

test('printer setup: choose the connection and paper, test print, saved on this device', async ({ page }) => {
  const c = await seedCafe();
  await placeOrder(c.slug, twoItems(c), { table_token: c.tables['1'].qr_token });
  await fakePrinters(page);
  await signIn(page, c.cafe.email);
  await page.goto('/owner/orders');

  await page.getByRole('button', { name: '📋 KOT' }).click();
  await page.getByRole('dialog', { name: 'KOT preview' }).getByRole('button', { name: 'Printer setup' }).click();
  const setup = page.getByRole('dialog', { name: 'Printer setup' });
  await setup.getByText('Bluetooth printer (BLE)').click();
  await setup.getByRole('button', { name: '58 mm' }).click();
  await setup.getByRole('button', { name: 'Connect & test print' }).click();
  await expect(page.getByText('Test print sent')).toBeVisible();
  expect(await printedText(page)).toContain('Test print');
  await setup.getByRole('button', { name: 'Save' }).click();
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('dv_printer')))).toMatchObject({ method: 'bluetooth', width: 58 });
  await expect(page.getByText(/Printer: Bluetooth printer \(BLE\) · 58 mm/)).toBeVisible();
});
