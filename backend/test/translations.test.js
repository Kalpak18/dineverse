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
