// Menu translations: cleaned on save, served on the public menu, clearable.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, api, createCafe, login } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('item + category translations are cleaned, served and clearable', async () => {
  const cafe = await createCafe(srv.db);
  const token = (await login(srv.base, cafe.email)).token;
  const cat = await api(srv.base, 'POST', '/menu/categories', {
    token, body: { name: 'Starters', translations: { hi: { name: 'स्टार्टर्स' }, xx: { name: 'junk' } } },
  });
  assert.deepEqual(cat.body.category.translations, { hi: { name: 'स्टार्टर्स' } });

  const item = await api(srv.base, 'POST', '/menu/items', {
    token,
    body: {
      name: 'Paneer Tikka', price: 220, category_id: cat.body.category.id,
      translations: {
        hi: { name: '  पनीर टिक्का  ', description: 'तंदूर में पका पनीर', calories: 300 },
        mr: { name: 'पनीर टिक्का' },
        fr: { name: 'Paneer' },
        ta: 'not an object',
      },
    },
  });
  assert.equal(item.status, 201);
  assert.deepEqual(item.body.item.translations, {
    hi: { name: 'पनीर टिक्का', description: 'तंदूर में पका पनीर' },
    mr: { name: 'पनीर टिक्का' },
  });

  const menu = await api(srv.base, 'GET', `/cafes/${cafe.slug}/menu`);
  const served = menu.body.menu.find((c) => c.name === 'Starters');
  assert.equal(served.translations.hi.name, 'स्टार्टर्स');
  assert.equal(served.items[0].translations.hi.name, 'पनीर टिक्का');

  // Updating other fields keeps translations; {} clears them
  const renamed = await api(srv.base, 'PATCH', `/menu/items/${item.body.item.id}`, { token, body: { price: 240 } });
  assert.equal(renamed.body.item.translations.hi.name, 'पनीर टिक्का');
  const cleared = await api(srv.base, 'PATCH', `/menu/items/${item.body.item.id}`, { token, body: { translations: {} } });
  assert.deepEqual(cleared.body.item.translations, {});
});

test('CSV import: all-or-nothing validation, creates categories, updates instead of duplicating', async () => {
  const cafe = await createCafe(srv.db);
  const token = (await login(srv.base, cafe.email)).token;
  const imp = (rows) => api(srv.base, 'POST', '/menu/import', { token, body: { rows } });

  const bad = await imp([
    { name: 'Masala Dosa', price: '140', category: 'South Indian' },
    { name: '', price: 'abc', is_veg: 'maybe' },
  ]);
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.errors.map((e) => e.row), [3, 3, 3]);
  assert.equal((await srv.db.query('SELECT COUNT(*)::int n FROM menu_items WHERE cafe_id = $1', [cafe.id])).rows[0].n, 0);

  const good = await imp([
    { name: 'Masala Dosa', price: '₹140', category: 'South Indian', is_veg: 'veg', hi_name: 'मसाला डोसा', tags: 'spicy; gluten-free' },
    { name: 'Chicken 65', price: '260', category: 'Starters', is_veg: 'non-veg' },
    { name: 'Filter Coffee', price: '40' },
  ]);
  assert.equal(good.status, 200);
  assert.deepEqual([good.body.created, good.body.updated, good.body.categories_created], [3, 0, 2]);
  const dosa = (await srv.db.query(`SELECT price, is_veg, tags, translations FROM menu_items WHERE cafe_id = $1 AND name = 'Masala Dosa'`, [cafe.id])).rows[0];
  assert.equal(Number(dosa.price), 140);
  assert.deepEqual(dosa.tags, ['spicy', 'gluten-free']);
  assert.equal(dosa.translations.hi.name, 'मसाला डोसा');
  assert.equal((await srv.db.query(`SELECT is_veg FROM menu_items WHERE name = 'Chicken 65' AND cafe_id = $1`, [cafe.id])).rows[0].is_veg, false);

  // Re-import with a new price updates the same item
  const again = await imp([{ name: 'masala dosa', price: '150', category: 'south indian' }]);
  assert.deepEqual([again.body.created, again.body.updated, again.body.categories_created], [0, 1, 0]);
  const rows = await srv.db.query(`SELECT price FROM menu_items WHERE cafe_id = $1 AND LOWER(name) = 'masala dosa'`, [cafe.id]);
  assert.equal(rows.rows.length, 1);
  assert.equal(Number(rows.rows[0].price), 150);
});
