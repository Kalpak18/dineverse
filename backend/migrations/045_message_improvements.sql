-- Migration 045: Message improvements
-- is_deleted: owner can soft-delete their own messages
-- customer_msg_read_at: track when customer last opened the chat (for seen receipts)
ALTER TABLE order_messages
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_msg_read_at TIMESTAMPTZ;
