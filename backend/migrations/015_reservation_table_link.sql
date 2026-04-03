-- Migration 015: Link reservations to specific tables + add duration
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES cafe_tables(id) ON DELETE SET NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS duration_minutes SMALLINT NOT NULL DEFAULT 90;

CREATE INDEX IF NOT EXISTS idx_reservations_table ON reservations(table_id, reserved_date);
