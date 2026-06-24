/**
 * Production startup wrapper.
 *
 * Runs DB migrations, then starts the server. Unlike the old chained
 * `migrate && app.js` start script, a migration failure here does NOT
 * prevent the server from booting — instead it records the failure in
 * a module-level status object that /health surfaces as "degraded".
 *
 * Why: the old behaviour took the entire service offline on any
 * migration syntax error. Customers couldn't even hit cafe pages.
 * Now: app still serves traffic; we get alerted via /health probe +
 * Sentry; ops can ship a fix without racing against downtime.
 */
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

// Optional: capture migration failures in Sentry too. Safe no-op if DSN absent.
let Sentry = null;
try {
  if (process.env.SENTRY_DSN) {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || undefined,
      tracesSampleRate: 0,
    });
  }
} catch (_) { /* sentry not yet installed — ignore */ }

const migrationStatus = {
  state: 'pending', // pending | running | success | failed
  startedAt: null,
  finishedAt: null,
  error: null,
  applied: [],
};

// Expose status to the app via env-like global so /health can read it
// without importing this script (which would re-run side effects).
global.__dineverse_migration_status = migrationStatus;

async function runMigrations() {
  migrationStatus.state = 'running';
  migrationStatus.startedAt = new Date().toISOString();

  return new Promise((resolve) => {
    const migrateScript = path.join(__dirname, 'migrate.js');
    const child = spawn(process.execPath, [migrateScript], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('close', (code) => {
      migrationStatus.finishedAt = new Date().toISOString();
      if (code === 0) {
        migrationStatus.state = 'success';
        console.log('[startup] Migrations completed successfully');
      } else {
        migrationStatus.state = 'failed';
        migrationStatus.error = `Migration script exited with code ${code}`;
        console.error('[startup] Migrations FAILED — server will still start, but /health will report degraded state');
        if (Sentry) {
          Sentry.captureMessage('Migration runner failed', {
            level: 'error',
            tags: { component: 'startup', exit_code: code },
          });
          Sentry.flush(2000).catch(() => {});
        }
      }
      resolve();
    });

    child.on('error', (err) => {
      migrationStatus.state = 'failed';
      migrationStatus.error = err.message;
      migrationStatus.finishedAt = new Date().toISOString();
      console.error('[startup] Failed to spawn migration process:', err.message);
      if (Sentry) {
        Sentry.captureException(err, { tags: { component: 'startup' } });
        Sentry.flush(2000).catch(() => {});
      }
      resolve();
    });
  });
}

async function startServer() {
  // require() the app AFTER migrations finish so any startup code that
  // expects a fully-migrated schema (e.g. cron schedulers) sees it.
  require('../src/app.js');
}

(async () => {
  await runMigrations();
  await startServer();
})();
