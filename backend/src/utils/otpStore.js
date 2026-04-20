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
    `INSERT INTO otp_codes (key, otp, expires_at, attempts)
     VALUES ($1, $2, NOW() + INTERVAL '${OTP_TTL_MINUTES} minutes', 0)
     ON CONFLICT (key) DO UPDATE
       SET otp        = EXCLUDED.otp,
           expires_at = EXCLUDED.expires_at,
           attempts   = 0,
           created_at = NOW()`,
    [key, otp]
  );
  return otp;
};

const MAX_OTP_ATTEMPTS = 3;

// Verifies OTP. Deletes on success (single-use). Rejects expired entries.
// Locks out after MAX_OTP_ATTEMPTS wrong guesses — forces a new OTP request.
exports.verifyOtp = async (email, otp, purpose = 'register') => {
  const key = `${purpose}:${email.toLowerCase()}`;

  // Fetch current record first to check attempts before consuming
  const fetch = await db.query(
    `SELECT otp, expires_at, attempts FROM otp_codes WHERE key = $1`,
    [key]
  );

  if (fetch.rows.length === 0) {
    return { valid: false, reason: 'No OTP sent to this email' };
  }

  const { otp: stored, expires_at, attempts } = fetch.rows[0];

  if (new Date() > new Date(expires_at)) {
    await db.query(`DELETE FROM otp_codes WHERE key = $1`, [key]);
    return { valid: false, reason: 'OTP expired — please request a new one' };
  }

  if (attempts >= MAX_OTP_ATTEMPTS) {
    await db.query(`DELETE FROM otp_codes WHERE key = $1`, [key]);
    return { valid: false, reason: 'Too many incorrect attempts — please request a new code' };
  }

  if (stored !== String(otp)) {
    // Increment attempt counter; delete on MAX_OTP_ATTEMPTS reached
    const newAttempts = attempts + 1;
    if (newAttempts >= MAX_OTP_ATTEMPTS) {
      await db.query(`DELETE FROM otp_codes WHERE key = $1`, [key]);
      return { valid: false, reason: 'Too many incorrect attempts — please request a new code' };
    }
    await db.query(
      `UPDATE otp_codes SET attempts = $1 WHERE key = $2`,
      [newAttempts, key]
    );
    return { valid: false, reason: 'Incorrect verification code' };
  }

  // Correct — delete to enforce single-use
  await db.query(`DELETE FROM otp_codes WHERE key = $1`, [key]);
  return { valid: true };
};

// Called by a periodic job (or at startup) to purge stale rows.
exports.cleanupExpired = async () => {
  const result = await db.query(`DELETE FROM otp_codes WHERE expires_at < NOW()`);
  return result.rowCount;
};
