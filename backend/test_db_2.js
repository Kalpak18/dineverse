const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:psql%40123@localhost:5432/foodie_db' });
pool.query("SELECT name, slug FROM cafes WHERE email='subagent123@example.com'")
  .then(res => { console.log(res.rows); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
