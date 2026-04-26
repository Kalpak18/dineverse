-- Migration 043: Add delivery_token + driver_updated_at to orders
-- delivery_token: random UUID used to authenticate driver GPS updates without requiring login
-- driver_updated_at: timestamp of last driver location ping
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_token    UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS driver_updated_at TIMESTAMPTZ;
