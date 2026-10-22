-- Migration 073: Bind refresh tokens to the principal that logged in.
-- Previously refresh_tokens only stored cafe_id, and /auth/refresh always
-- minted an OWNER JWT — so a staff member could escalate to owner.

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES cafe_staff(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_staff_id ON refresh_tokens(staff_id);

-- Existing tokens can't be attributed to owner vs staff, so revoke them all.
-- Users re-login once their current access token expires.
UPDATE refresh_tokens SET revoked = TRUE WHERE staff_id IS NULL AND revoked = FALSE;
