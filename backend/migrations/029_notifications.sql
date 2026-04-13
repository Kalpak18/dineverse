-- Migration 029: persistent owner notifications
-- Stores every important event so owners see alerts after refresh/reconnect.

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  cafe_id    UUID        NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,  -- new_order | new_reservation | item_sold_out | new_waitlist | order_message
  title      TEXT        NOT NULL,
  body       TEXT,
  ref_id     VARCHAR(100),          -- order_id / reservation_id / menu_item_id etc.
  is_read    BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_cafe_unread
  ON notifications(cafe_id, is_read, created_at DESC);
