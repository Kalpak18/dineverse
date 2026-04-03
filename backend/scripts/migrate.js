/**
 * Runs all SQL migration files in backend/migrations/ in numeric order.
 * Tracks applied migrations in a _migrations table so re-runs are safe.
 *
 * Bootstrap: if _migrations table is new AND tables from the schema already
 * exist, all previous migrations are stamped as applied without re-running.
 *
 * Usage:  node scripts/migrate.js
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
});

async function run() {
  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    // Create tracking table if it doesn't exist
    const { rowCount } = await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id        SERIAL PRIMARY KEY,
        filename  VARCHAR(255) UNIQUE NOT NULL,
        run_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Bootstrap: if _migrations was just created AND the cafes table already
    // exists, stamp all migration files as applied (they were run manually before).
    const { rows: trackingRows } = await client.query('SELECT COUNT(*) AS c FROM _migrations');
    const isFirstRun = parseInt(trackingRows[0].c, 10) === 0;

    if (isFirstRun) {
      const { rows: cafesExists } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'cafes'
      `);
      if (cafesExists.length > 0) {
        console.log('Bootstrap: stamping all existing migrations as applied…');
        for (const file of files) {
          await client.query(
            'INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [file]
          );
          console.log(`  stamp  ${file}`);
        }
        console.log('\nBootstrap complete. Future migrations will run normally.');
        return;
      }
    }

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM _migrations WHERE filename = $1', [file]
      );
      if (rows.length > 0) {
        console.log(`  skip   ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✓      ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗      ${file}: ${err.message}`);
        process.exit(1);
      }
    }
    console.log('\nAll migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration runner failed:', err.message);
  process.exit(1);
});
