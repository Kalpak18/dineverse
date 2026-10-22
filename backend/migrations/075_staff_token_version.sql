-- Migration 075: Per-staff session version.
-- Staff JWTs were compared against cafes.token_version, so they couldn't be
-- revoked individually (and would all break once the owner's version moved).
ALTER TABLE cafe_staff ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;
