// DB-backed OTP store. Uses otp_codes table (migration 019).
// Supports multi-process / multi-server deployments and survives restarts.
// Keys are scoped: `${purpose}:${email}` to prevent cross-purpose OTP reuse.

const db = require('../config/database');

const OTP_TTL_MINUTES = 10;

function generate6Digit() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Upsert: replaces any existing OTP for this key (latest wins).
// purpose: 'register' | 'reset' | 'admin_reset'
exports.createOtp = async (email, purpose = 'register') => {
  const otp = generate6Digit();
  const key = `${purpose}:${email.toLowerCase()}`;
  await db.query(
    `INSERT INTO otp_codes (key, otp, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '${OTP_TTL_MINUTES} minutes')
     ON CONFLICT (key) DO UPDATE
       SET otp        = EXCLUDED.otp,
           expires_at = EXCLUDED.expires_at,
           created_at = NOW()`,
    [key, otp]
  );
  return otp;
};

// Verifies OTP. Deletes on success (single-use). Rejects expired entries.
exports.verifyOtp = async (email, otp, purpose = 'register') => {
  const key = `${purpose}:${email.toLowerCase()}`;

  // Fetch (and atomically delete) — prevents race-condition double-use
  const result = await db.query(
    `DELETE FROM otp_codes
     WHERE key = $1
     RETURNING otp, expires_at`,
    [key]
  );

  if (result.rows.length === 0) {
    return { valid: false, reason: 'No OTP sent to this email' };
  }

  const { otp: stored, expires_at } = result.rows[0];

  if (new Date() > new Date(expires_at)) {
    return { valid: false, reason: 'OTP expired — please request a new one' };
  }

  if (stored !== String(otp)) {
    // Re-insert so the user can retry (we already deleted above)
    await db.query(
      `INSERT INTO otp_codes (key, otp, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE
         SET otp = EXCLUDED.otp, expires_at = EXCLUDED.expires_at`,
      [key, stored, expires_at]
    );
    return { valid: false, reason: 'Incorrect verification code' };
  }

  return { valid: true };
};

// Called by a periodic job (or at startup) to purge stale rows.
exports.cleanupExpired = async () => {
  const result = await db.query(`DELETE FROM otp_codes WHERE expires_at < NOW()`);
  return result.rowCount;
};
