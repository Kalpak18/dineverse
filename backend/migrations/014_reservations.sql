-- Migration 014: Table reservations
CREATE TABLE IF NOT EXISTS reservations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id         UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  customer_name   VARCHAR(100) NOT NULL,
  customer_phone  VARCHAR(20) NOT NULL,
  party_size      SMALLINT NOT NULL DEFAULT 2 CHECK (party_size > 0),
  reserved_date   DATE NOT NULL,
  reserved_time   TIME NOT NULL,
  area_id         UUID REFERENCES areas(id) ON DELETE SET NULL,
  notes           TEXT,
  -- pending | confirmed | cancelled | completed | no_show
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','cancelled','completed','no_show')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reservations_cafe_id   ON reservations(cafe_id);
CREATE INDEX IF NOT EXISTS idx_reservations_date      ON reservations(cafe_id, reserved_date);

CREATE TRIGGER update_reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
