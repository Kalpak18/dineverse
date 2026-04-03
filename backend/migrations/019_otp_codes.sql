-- Migration 019: DB-backed OTP store (replaces in-memory Map)
-- Supports multi-process / multi-server deployments.
-- Survives server restarts. TTL enforced at query time + periodic cleanup.

CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key        VARCHAR(320) NOT NULL,          -- '{purpose}:{email}', unique per slot
  otp        VARCHAR(10)  NOT NULL,
  expires_at TIMESTAMPTZ  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_codes_key ON otp_codes(key);
CREATE INDEX        IF NOT EXISTS idx_otp_codes_expires ON otp_codes(expires_at);
