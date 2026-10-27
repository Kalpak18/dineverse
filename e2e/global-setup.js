// Fresh DB + migrations → API (Razorpay stubbed) → production build → static
// server with the Vercel headers. State for tests/teardown goes to .state.json.
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');
const STATE = path.join(__dirname, '.state.json');

async function waitFor(url, label, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${label} did not come up at ${url}`);
}

module.exports = async () => {
  const webPort = Number(process.env.E2E_WEB_PORT || 4610);
  const apiPort = Number(process.env.E2E_API_PORT || 4611);
  const apiOrigin = `http://localhost:${apiPort}`;
  const adminUrl = process.env.TEST_PG_URL || 'postgres://localhost/postgres';
  const dbName = 'dineverse_e2e';

  const admin = new Pool({ connectionString: adminUrl });
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  const dbUrl = Object.assign(new URL(adminUrl), { pathname: `/${dbName}` }).toString();
  execFileSync('node', ['scripts/migrate.js'], { cwd: BACKEND, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'ignore' });

  if (!process.env.E2E_SKIP_BUILD) {
    execFileSync('npx', ['vite', 'build'], {
      cwd: FRONTEND, stdio: 'ignore',
      env: { ...process.env, VITE_BACKEND_URL: apiOrigin, VITE_API_URL: '' },
    });
  }

  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const rzpLog = path.join(os.tmpdir(), `dineverse-e2e-rzp-${Date.now()}.log`);
  fs.writeFileSync(rzpLog, '');
  const apiLog = path.join(os.tmpdir(), `dineverse-e2e-api-${Date.now()}.log`);
  const api = spawn('node', ['-r', path.join(BACKEND, 'test', 'razorpayStub.js'), 'src/app.js'], {
    cwd: BACKEND,
    detached: true,
    stdio: ['ignore', fs.openSync(apiLog, 'w'), fs.openSync(apiLog, 'a')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(apiPort),
      DATABASE_URL: dbUrl,
      JWT_SECRET: jwtSecret,
      CLIENT_URL: `http://localhost:${webPort}`,
      RAZORPAY_KEY_ID: 'rzp_test_e2e',
      RAZORPAY_KEY_SECRET: 'rzp_e2e_secret',
      RAZORPAY_WEBHOOK_SECRET: 'rzp_e2e_webhook',
      RZP_LOG: rzpLog,
      REDIS_URL: '',
      RESEND_API_KEY: '',
    },
  });
  api.unref();
  const web = spawn('node', [path.join(__dirname, 'serve.js'), String(webPort), apiOrigin], { detached: true, stdio: 'ignore' });
  web.unref();

  await waitFor(`${apiOrigin}/health`, 'API');
  await waitFor(`http://localhost:${webPort}/`, 'web');

  fs.writeFileSync(STATE, JSON.stringify({
    pids: [api.pid, web.pid], adminUrl, dbName, dbUrl, apiOrigin, webOrigin: `http://localhost:${webPort}`,
    jwtSecret, rzpLog, apiLog, rzpSecret: 'rzp_e2e_secret', rzpWebhookSecret: 'rzp_e2e_webhook',
  }, null, 2));
};
