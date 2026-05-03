const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:psql%40123@localhost:5432/foodie_db' });
pool.query("UPDATE cafes SET slug = 'subagent-test-cafe' WHERE slug = 'subagent-test-cafesubagent-test-cafe'")
  .then(res => { console.log('Fixed:', res.rowCount); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
