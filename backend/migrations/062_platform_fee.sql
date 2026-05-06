-- Add transparent platform_fee columns to orders (consumer-facing charge).
-- Platform fee is shown to customers on the bill and added to their total.
-- Lower default commission_rate to 2% for new cafés.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS platform_fee      NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_fee_rate NUMERIC(5,2)  NOT NULL DEFAULT 0;

-- Lower default for newly-created cafés
ALTER TABLE cafes
  ALTER COLUMN commission_rate SET DEFAULT 2.00;
