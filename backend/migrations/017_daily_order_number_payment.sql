-- Migration 017: Daily order number per café + customer order payment tracking

-- ── Daily order number ──────────────────────────────────────────
-- Resets to 1 every new day, per café (used for kitchen tokens & receipts)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS daily_order_number INTEGER;

-- Trigger function: counts today's orders for this café to assign daily number
CREATE OR REPLACE FUNCTION set_daily_order_number()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(MAX(daily_order_number), 0) + 1
  INTO NEW.daily_order_number
  FROM orders
  WHERE cafe_id = NEW.cafe_id
    AND DATE(created_at AT TIME ZONE 'Asia/Kolkata') = DATE(NOW() AT TIME ZONE 'Asia/Kolkata');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_daily_order_number ON orders;
CREATE TRIGGER trg_daily_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION set_daily_order_number();

-- Back-fill existing rows with a reasonable daily number (best-effort, ordered by created_at)
DO $$
DECLARE
  r RECORD;
  day_date DATE;
  prev_date DATE := NULL;
  prev_cafe UUID := NULL;
  counter INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id, cafe_id, DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS order_date
    FROM orders
    WHERE daily_order_number IS NULL
    ORDER BY cafe_id, created_at
  LOOP
    day_date := r.order_date;
    IF r.cafe_id != prev_cafe OR day_date != prev_date THEN
      counter := 1;
    ELSE
      counter := counter + 1;
    END IF;
    UPDATE orders SET daily_order_number = counter WHERE id = r.id;
    prev_cafe  := r.cafe_id;
    prev_date  := day_date;
  END LOOP;
END;
$$;

-- ── Customer order payment ──────────────────────────────────────
-- Tracks Razorpay payment for individual food orders (separate from subscription payments)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_order_id  VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id        VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_verified  BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_payment_order_id ON orders(payment_order_id) WHERE payment_order_id IS NOT NULL;
