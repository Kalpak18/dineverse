-- 069_item_prep_time.sql
-- Per-item prep time tracking: kitchen sets how long each item will take to cook.
-- ETA shown to customer, cashier, and KDS in real time.

-- Two columns on order_items:
--   prep_started_at  — when the kitchen tapped "Start cooking" for this item
--   prep_duration_mins — how many minutes the kitchen said it would take
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS prep_started_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prep_duration_mins  SMALLINT;

-- Optional default on menu items — pre-fills the KDS input
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS default_prep_mins SMALLINT;

-- Index for queries that join order_items on prep status
CREATE INDEX IF NOT EXISTS idx_order_items_prep
  ON order_items (prep_started_at)
  WHERE prep_started_at IS NOT NULL;
