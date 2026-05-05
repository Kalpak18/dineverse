-- Switch from subscription billing to commission-per-order model.
-- Each café has a commission_rate (percentage of each paid order).
-- commission_amount is recorded on the order when status → paid.

ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) NOT NULL DEFAULT 5.00;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Index for fast per-cafe commission reporting
CREATE INDEX IF NOT EXISTS idx_orders_commission_paid
  ON orders (cafe_id, commission_amount, status)
  WHERE status = 'paid';
