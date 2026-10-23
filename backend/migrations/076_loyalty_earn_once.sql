-- Migration 076: An order earns loyalty points at most once.
-- Prepaid orders hit earnPoints both on payment verify and when marked paid.
-- Drop any duplicate earn rows (keep the first) before adding the guard.
DELETE FROM loyalty_transactions lt
USING loyalty_transactions dup
WHERE lt.type = 'earn' AND dup.type = 'earn'
  AND lt.order_id = dup.order_id
  AND (lt.created_at, lt.id) > (dup.created_at, dup.id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_loyalty_earn_per_order
  ON loyalty_transactions (order_id) WHERE type = 'earn';
