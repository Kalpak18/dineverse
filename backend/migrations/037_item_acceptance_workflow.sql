-- Migration 037: Add item-level cancellation reasons and acceptance workflow
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS accepted BOOLEAN NOT NULL DEFAULT true;

-- Add index for accepted items
CREATE INDEX IF NOT EXISTS idx_order_items_accepted ON order_items(accepted);

-- Add order acceptance status
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS accepted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acceptance_time TIMESTAMPTZ;

-- Add index for order acceptance
CREATE INDEX IF NOT EXISTS idx_orders_accepted ON orders(accepted);