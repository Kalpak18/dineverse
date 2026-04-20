const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // In production use SSL with full cert verification.
  // Set DB_SSL_REJECT_UNAUTHORIZED=false only if your provider uses self-signed certs (e.g. Render, Railway).
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
  // Kill runaway queries after 15 seconds to prevent DB connection starvation
  statement_timeout: 15000,
  // Idle connections returned to pool after 30 seconds
  idleTimeoutMillis: 30000,
  // Max pool size — 20 handles production traffic; reduce to 5 if using PgBouncer
  max: 20,
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL client error: %s', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
