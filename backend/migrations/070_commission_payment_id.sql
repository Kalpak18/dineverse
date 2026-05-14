-- Track which Razorpay payment settled the commission for each batch of orders.
-- Used to make webhook + /commission/verify idempotent: if the same payment_id
-- is seen twice (webhook fires after verify, or network retry), the second
-- update finds no matching rows and returns immediately.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS commission_payment_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_orders_commission_payment_id
  ON orders (commission_payment_id)
  WHERE commission_payment_id IS NOT NULL;
