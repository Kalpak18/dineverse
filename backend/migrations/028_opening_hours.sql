-- Migration 028: café operating hours + timezone
-- opening_hours: JSONB keyed by 3-letter day (mon/tue/wed/thu/fri/sat/sun)
--   Each entry: { "open": "HH:MM", "close": "HH:MM", "closed": bool }
--   NULL means no schedule set — fall back to manual is_open toggle only.
-- timezone: IANA tz string, default IST so time math works without owner config.

ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS opening_hours JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS timezone      VARCHAR(60) DEFAULT 'Asia/Kolkata';

-- Index for quick reads when checking is_open at order time (not strictly needed
-- but makes the column show up in pg_stat_user_tables query plans clearly)
COMMENT ON COLUMN cafes.opening_hours IS
  'Weekly schedule: { mon: { open, close, closed }, ... }. NULL = no schedule.';
COMMENT ON COLUMN cafes.timezone IS
  'IANA timezone for interpreting opening_hours. Default: Asia/Kolkata.';
