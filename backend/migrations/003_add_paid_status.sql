-- Migration 003: Add 'paid' status to orders
-- Run: psql $DATABASE_URL -f migrations/003_add_paid_status.sql

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'preparing', 'served', 'paid', 'cancelled'));
