const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

module.exports = async () => {
  const file = path.join(__dirname, '.state.json');
  if (!fs.existsSync(file)) return;
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const pid of state.pids) {
    try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  }
  await new Promise((r) => setTimeout(r, 500));
  const admin = new Pool({ connectionString: state.adminUrl });
  await admin.query(`DROP DATABASE IF EXISTS "${state.dbName}" WITH (FORCE)`).catch(() => {});
  await admin.end();
  if (process.env.E2E_KEEP_LOGS) console.log(`API log kept at ${state.apiLog}`);
  else for (const f of [state.rzpLog, state.apiLog]) fs.rmSync(f, { force: true });
  fs.rmSync(file, { force: true });
};
