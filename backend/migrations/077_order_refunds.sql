-- Migration 077: Track refunds of prepaid (Razorpay) orders that get cancelled.
-- refund_status: pending (claimed, API call in flight) | processed | failed
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refund_id     TEXT,
  ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS refunded_at   TIMESTAMPTZ;
