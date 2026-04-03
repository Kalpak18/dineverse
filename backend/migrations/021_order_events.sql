-- Migration 021: Order audit trail
-- Logs every status change: who changed it, when, from/to status, and optional note.
-- actor_type: 'owner' | 'staff' | 'customer' | 'system'

CREATE TABLE IF NOT EXISTS order_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status VARCHAR(20),
  to_status   VARCHAR(20) NOT NULL,
  actor_type  VARCHAR(20) NOT NULL DEFAULT 'system',
  actor_id    UUID,                    -- cafe_id (owner) or staff_id
  actor_name  VARCHAR(100),            -- denormalized for readability after staff deletion
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id   ON order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_order_events_created_at ON order_events(created_at DESC);
