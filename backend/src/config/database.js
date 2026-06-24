const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
  // Kill runaway queries after 15 s — prevents slow queries starving the pool
  statement_timeout: 15000,
  // Return idle connections quickly; reduces memory on hobby/single-instance plans
  idleTimeoutMillis: 30000,
  // Connection timeout: fail fast rather than queue indefinitely
  connectionTimeoutMillis: 5000,
  // 10 connections per instance. If scaling horizontally use PgBouncer in front.
  max: parseInt(process.env.DB_POOL_MAX || '10'),
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL client error: %s', err.message);
});

// Pool saturation telemetry. waitingCount > 0 sustained means queries are
// queueing — the early warning that we need a bigger pool or PgBouncer.
// Emits structured logs so dashboards can chart pool utilisation.
if (process.env.NODE_ENV === 'production') {
  let lastWarnedAt = 0;
  setInterval(() => {
    const total = pool.totalCount;
    const idle = pool.idleCount;
    const waiting = pool.waitingCount;
    logger.info('db_pool_stats', {
      pool_total: total,
      pool_idle: idle,
      pool_in_use: total - idle,
      pool_waiting: waiting,
      pool_max: pool.options?.max,
    });
    // If anything is waiting for >0 we warn loudly. Throttle to once a minute
    // so we don't spam the log/Sentry.
    if (waiting > 0 && Date.now() - lastWarnedAt > 60_000) {
      lastWarnedAt = Date.now();
      logger.warn('db_pool_saturated', { waiting, total, max: pool.options?.max });
      try {
        if (process.env.SENTRY_DSN) {
          // Lazy require so dev runs don't load Sentry SDK
          const Sentry = require('@sentry/node');
          Sentry.captureMessage('DB pool saturated', {
            level: 'warning',
            tags: { component: 'db_pool' },
            extra: { waiting, total, max: pool.options?.max },
          });
        }
      } catch (_) { /* ignore */ }
    }
  }, 10_000).unref();
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
