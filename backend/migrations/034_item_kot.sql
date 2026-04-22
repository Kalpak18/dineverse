-- Per-item kitchen order tracking + kitchen mode (combined vs individual)
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS item_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (item_status IN ('pending', 'preparing', 'ready', 'served'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS kitchen_mode VARCHAR(20) NOT NULL DEFAULT 'combined'
    CHECK (kitchen_mode IN ('combined', 'individual'));

CREATE INDEX IF NOT EXISTS idx_order_items_item_status ON order_items(item_status);
