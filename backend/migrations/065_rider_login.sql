-- Rider login support: extend cafe_riders so each rider can authenticate
-- via email OTP (phone OTP path is wired in the backend but commented out
-- pending an SMS gateway).
ALTER TABLE cafe_riders
  ADD COLUMN IF NOT EXISTS email          VARCHAR(120),
  ADD COLUMN IF NOT EXISTS last_seen_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS token_version  INTEGER NOT NULL DEFAULT 1;

-- One active rider per email (case-insensitive). Allows multiple inactive
-- (deleted) records with the same email — useful when a rider rejoins.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cafe_riders_email_active
  ON cafe_riders (LOWER(email))
  WHERE is_active = true AND email IS NOT NULL;
