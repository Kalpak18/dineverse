-- Token version: incrementing this for a café invalidates all their existing JWTs.
-- Use case: leaked JWT_SECRET rotation, suspicious activity, password change.
ALTER TABLE cafes ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;
