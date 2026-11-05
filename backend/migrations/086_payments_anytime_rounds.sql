-- Migration 086: Payment at any time + added rounds + staff-entered orders.
-- amount_paid: money received for this order so far (counter or online).
--   Balance = final_amount - amount_paid (negative = refund owed to the
--   customer, e.g. an item cancelled after paying). status 'paid' still means
--   finished and closed; paying early no longer closes the order.
-- added_to_order_id: a round added later to an order (new KOT); points at
--   the first order so screens can show them together.
-- source: who entered the order — the customer (QR/app) or staff (counter).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS added_to_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'customer';
CREATE INDEX IF NOT EXISTS idx_orders_added_to ON orders (added_to_order_id) WHERE added_to_order_id IS NOT NULL;

-- Existing paid / prepaid orders: record what was received
UPDATE orders SET amount_paid = COALESCE(final_amount, total_amount), paid_at = COALESCE(paid_at, updated_at)
 WHERE (status = 'paid' OR payment_verified) AND amount_paid = 0;
