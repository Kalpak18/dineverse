-- Allow orders to survive a café hard-delete so platform commission history is preserved.
-- When a café is deleted, we NULL out cafe_id and store the café name for reporting.

-- orders: make cafe_id nullable, add deleted_cafe_name for historical context
ALTER TABLE orders
  ALTER COLUMN cafe_id DROP NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS deleted_cafe_name TEXT;

-- commission_settlements: make cafe_id nullable for same reason
ALTER TABLE commission_settlements
  ALTER COLUMN cafe_id DROP NOT NULL;

ALTER TABLE commission_settlements
  ADD COLUMN IF NOT EXISTS deleted_cafe_name TEXT;
