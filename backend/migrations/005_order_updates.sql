-- Order type: dine-in or takeaway
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(10) NOT NULL DEFAULT 'dine-in';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check
  CHECK (order_type IN ('dine-in', 'takeaway'));

-- Idempotency key: prevents duplicate orders from double-clicks / network retries
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_order_id VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS orders_client_order_id_idx
  ON orders(client_order_id) WHERE client_order_id IS NOT NULL;

-- Billing: store cash received and change at settlement time
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_received NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS change_amount  NUMERIC(10,2);

-- Add 'ready' status to lifecycle (keep 'confirmed' for backward compat with existing data)
-- New flow: pending → preparing → ready → served → paid
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'served', 'paid', 'cancelled'));
