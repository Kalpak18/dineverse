-- Migration 084: Item-level (partial) refunds for prepaid orders.
-- One row per refunded item; the unique index makes item refunds idempotent.
CREATE TABLE IF NOT EXISTS order_refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id            UUID REFERENCES order_items(id) ON DELETE SET NULL,
  amount             NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  razorpay_refund_id TEXT,
  status             VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  reason             TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_order_refunds_item ON order_refunds (order_id, item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_refunds_order ON order_refunds (order_id);
