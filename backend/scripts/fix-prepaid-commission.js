#!/usr/bin/env node
/**
 * One-off repair for the pre-fix commission bug (audit §2 #1).
 *
 * Before the fix, an order paid online through DineVerse (payment_verified)
 * was marked commission_status='cash_due' when it was later marked paid —
 * so the café was billed commission that DineVerse had already kept.
 *
 *   node scripts/fix-prepaid-commission.js            # dry run: report only
 *   node scripts/fix-prepaid-commission.js --apply    # fix the 'cash_due' ones
 *
 * --apply only flips prepaid 'cash_due' orders to 'auto_deducted'.
 * Prepaid orders already 'collected' (the café PAID that commission a second
 * time) are listed for a manual refund decision and never changed here.
 * Needs DATABASE_URL.
 */
const { Pool } = require('pg');

const apply = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
});

const inr = (n) => `₹${Number(n).toFixed(2)}`;

async function report(client, status) {
  const r = await client.query(
    `SELECT c.name AS cafe, c.id AS cafe_id, COUNT(*)::int AS orders, COALESCE(SUM(o.commission_amount), 0) AS commission
     FROM orders o JOIN cafes c ON c.id = o.cafe_id
     WHERE o.payment_verified = true AND o.commission_status = $1
     GROUP BY c.id, c.name ORDER BY commission DESC`,
    [status]
  );
  return r.rows;
}

(async () => {
  const client = await pool.connect();
  try {
    const due = await report(client, 'cash_due');
    const collected = await report(client, 'collected');

    console.log(`\nPrepaid orders wrongly marked commission OWED (cash_due): ${due.reduce((s, r) => s + r.orders, 0)}`);
    due.forEach((r) => console.log(`  ${r.cafe} (${r.cafe_id}): ${r.orders} orders, ${inr(r.commission)}`));

    console.log(`\nPrepaid orders whose commission the café already PAID again (collected) — refund decision needed: ${collected.reduce((s, r) => s + r.orders, 0)}`);
    collected.forEach((r) => console.log(`  ${r.cafe} (${r.cafe_id}): ${r.orders} orders, ${inr(r.commission)} to refund`));

    if (!apply) {
      console.log('\nDry run — nothing changed. Re-run with --apply to fix the cash_due orders.\n');
      return;
    }
    await client.query('BEGIN');
    const fixed = await client.query(
      `UPDATE orders SET commission_status = 'auto_deducted'
       WHERE payment_verified = true AND commission_status = 'cash_due'
       RETURNING id`
    );
    await client.query('COMMIT');
    console.log(`\nApplied: ${fixed.rows.length} orders changed cash_due → auto_deducted. 'collected' orders untouched.\n`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
