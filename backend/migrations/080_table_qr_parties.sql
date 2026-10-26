-- Migration 080: Verified tables + dining parties.
-- Table numbers used to be free text from the customer's browser, so anyone
-- could put an order (and its charge) on another table's bill.
--
-- 1. Each table gets a secret QR token; a dine-in order is "verified" only
--    when placed through that token. Unverified orders stay off table bills
--    until staff confirm or move them.
ALTER TABLE cafe_tables ADD COLUMN IF NOT EXISTS qr_token TEXT;
UPDATE cafe_tables
   SET qr_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 WHERE qr_token IS NULL;
ALTER TABLE cafe_tables
  ALTER COLUMN qr_token SET DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  ALTER COLUMN qr_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cafe_tables_qr_token ON cafe_tables (qr_token);

-- 2. A party = the orders placed from one customer device (server-issued
--    secret held on that device). Grouping is never by phone number, which
--    is unverified and would let anyone join someone else's bill.
CREATE TABLE IF NOT EXISTS dining_parties (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id    UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  secret     TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS table_id         UUID REFERENCES cafe_tables(id) ON DELETE SET NULL,
  -- existing orders keep today's behaviour; new rows default to unverified
  ADD COLUMN IF NOT EXISTS table_verified   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS party_id         UUID REFERENCES dining_parties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moved_from_table TEXT,
  ADD COLUMN IF NOT EXISTS moved_at         TIMESTAMPTZ;
ALTER TABLE orders ALTER COLUMN table_verified SET DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_orders_party_id ON orders (party_id) WHERE party_id IS NOT NULL;
