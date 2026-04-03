-- Migration 016: Structured address fields + multi-outlet support

-- Structured address (address column stays as address_line1)
ALTER TABLE cafes ADD COLUMN IF NOT EXISTS address_line2 VARCHAR(255);
ALTER TABLE cafes ADD COLUMN IF NOT EXISTS state          VARCHAR(100);
ALTER TABLE cafes ADD COLUMN IF NOT EXISTS pincode        VARCHAR(20);

-- Multi-outlet: outlet rows point back to the parent brand account
ALTER TABLE cafes ADD COLUMN IF NOT EXISTS parent_cafe_id UUID REFERENCES cafes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_cafes_parent ON cafes(parent_cafe_id);
