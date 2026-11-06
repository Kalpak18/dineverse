const test = require('node:test');
const assert = require('node:assert');
const { appUrl } = require('../src/utils/appUrl');

function withEnv(env, fn) {
  const saved = { APP_URL: process.env.APP_URL, CLIENT_URL: process.env.CLIENT_URL };
  for (const k of Object.keys(saved)) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('email links skip the Vercel deploy address in CLIENT_URL', () => {
  withEnv({ CLIENT_URL: 'https://dineverse.vercel.app,https://www.dine-verse.com,https://dine-verse.com' }, () => {
    assert.strictEqual(appUrl(), 'https://www.dine-verse.com');
  });
});

test('APP_URL wins; trailing slash dropped', () => {
  withEnv({ APP_URL: 'https://app.example.com/', CLIENT_URL: 'https://dineverse.vercel.app' }, () => {
    assert.strictEqual(appUrl(), 'https://app.example.com');
  });
});

test('falls back to the real domain when CLIENT_URL has only deploy / local addresses', () => {
  withEnv({ CLIENT_URL: 'https://dineverse.vercel.app,http://localhost:5173' }, () => {
    assert.strictEqual(appUrl(), 'https://www.dine-verse.com');
  });
});
