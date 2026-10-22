-- Migration 074: Per-order secret for customer-facing endpoints.
-- Order IDs leak (table bill, socket rooms, owner links), so possessing an ID
-- must not be enough to read, cancel, pay or chat on someone else's order.
-- NULL for orders placed before this migration (legacy checks apply).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_token TEXT;
