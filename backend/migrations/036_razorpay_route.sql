-- Razorpay Route: linked account per café for direct payouts
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS razorpay_account_id     TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_account_status TEXT NOT NULL DEFAULT 'not_connected',
  ADD COLUMN IF NOT EXISTS razorpay_route_enabled  BOOLEAN NOT NULL DEFAULT false;

-- Index for quick lookup during payment creation
CREATE INDEX IF NOT EXISTS idx_cafes_razorpay_account
  ON cafes(razorpay_account_id)
  WHERE razorpay_account_id IS NOT NULL;
