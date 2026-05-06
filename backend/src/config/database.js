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
  idleTimeoutMillis: 10000,
  // Connection timeout: fail fast rather than queue indefinitely
  connectionTimeoutMillis: 5000,
  // 10 connections per instance. If scaling horizontally use PgBouncer in front.
  max: parseInt(process.env.DB_POOL_MAX || '10'),
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL client error: %s', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
