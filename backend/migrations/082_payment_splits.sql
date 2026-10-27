-- Migration 082: Split bills collected at the counter.
-- [{ "amount": 300.00, "mode": "cash" }, { "amount": 312.00, "mode": "upi" }]
-- Stored on the first order of the table bill (like cash_received); payment_mode = 'split'.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_splits JSONB;
