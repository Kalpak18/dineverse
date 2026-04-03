-- Migration 018: Cancellation reason on orders + order chat messages

-- ── Cancellation reason ─────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- ── Order messages (customer ↔ owner chat) ──────────────────────
CREATE TABLE IF NOT EXISTS order_messages (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  cafe_id     UUID          NOT NULL REFERENCES cafes(id)  ON DELETE CASCADE,
  sender_type VARCHAR(10)   NOT NULL CHECK (sender_type IN ('customer', 'owner')),
  message     TEXT          NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_messages_order ON order_messages(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_messages_cafe  ON order_messages(cafe_id, created_at DESC);
