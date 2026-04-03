require('dotenv').config();
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  try {
    const m = await pool.query('SELECT filename FROM _migrations ORDER BY filename');
    console.log('Applied _migrations count:', m.rowCount);
    m.rows.forEach(r => console.log(' ', r.filename));

    const t = await pool.query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_settings')");
    console.log('platform_settings exists:', t.rows[0].exists);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
})();
