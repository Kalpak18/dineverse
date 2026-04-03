-- Feature: name style, precise location, areas & tables

-- 1. Café name display style (bold / italic)
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS name_style VARCHAR(20) NOT NULL DEFAULT 'normal';
-- values: 'normal' | 'bold' | 'italic' | 'bold-italic'

-- 2. Precise location (lat/lng from map picker)
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(10, 7);

-- 3. Areas (e.g. Garden, AC Hall, Rooftop)
CREATE TABLE IF NOT EXISTS areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id     UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_areas_cafe ON areas(cafe_id);

-- 4. Tables within areas (label = what customer sees, e.g. "T1", "1", "Window Seat")
CREATE TABLE IF NOT EXISTS cafe_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id     UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  area_id     UUID REFERENCES areas(id) ON DELETE SET NULL,
  label       VARCHAR(50) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tables_cafe ON cafe_tables(cafe_id);
CREATE INDEX IF NOT EXISTS idx_tables_area ON cafe_tables(area_id);
