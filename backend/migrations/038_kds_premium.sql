-- Migration 038: Premium tier + KDS schema
-- Adds plan_tier to cafes, extends order_items for per-item kitchen tracking,
-- and creates the kot_slips table for Kitchen Order Tickets.

-- 1. Premium tier column on cafes
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(20) NOT NULL DEFAULT 'basic';
ALTER TABLE cafes DROP CONSTRAINT IF EXISTS cafes_plan_tier_check;
ALTER TABLE cafes ADD CONSTRAINT cafes_plan_tier_check
  CHECK (plan_tier IN ('basic', 'premium'));

-- 2. Extend plan_type constraint to accept new tiered plan keys
ALTER TABLE cafes DROP CONSTRAINT IF EXISTS cafes_plan_type_check;
ALTER TABLE cafes ADD CONSTRAINT cafes_plan_type_check
  CHECK (plan_type IN (
    'free_trial',
    'yearly', 'two_year', 'three_year',
    'basic_1year', 'basic_2year', 'basic_3year',
    'premium_1year', 'premium_2year', 'premium_3year'
  ));

-- 3. Per-item course sequencing + timestamps
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS sort_order   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preparing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS served_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- 4. Extend item_status to include 'cancelled'
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_item_status_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_item_status_check
  CHECK (item_status IN ('pending', 'preparing', 'ready', 'served', 'cancelled'));

-- 5. KOT slips table — one slip per batch of ready items
CREATE TABLE IF NOT EXISTS kot_slips (
  id            SERIAL PRIMARY KEY,
  cafe_id       INT NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  order_id      INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  slip_number   INT NOT NULL,
  table_number  VARCHAR(50),
  customer_name VARCHAR(100),
  items         JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  printed_at    TIMESTAMPTZ,
  UNIQUE (order_id, slip_number)
);
CREATE INDEX IF NOT EXISTS idx_kot_slips_order ON kot_slips(order_id);
CREATE INDEX IF NOT EXISTS idx_kot_slips_cafe  ON kot_slips(cafe_id, created_at DESC);
