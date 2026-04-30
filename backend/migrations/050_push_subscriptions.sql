-- Web Push subscriptions — one row per browser/device per café
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id               SERIAL PRIMARY KEY,
  cafe_id          UUID        NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  endpoint         TEXT        NOT NULL UNIQUE,
  p256dh           TEXT        NOT NULL,
  auth             TEXT        NOT NULL,
  subscriber_type  VARCHAR(20) NOT NULL DEFAULT 'owner', -- 'owner' | 'customer'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_cafe_type
  ON push_subscriptions (cafe_id, subscriber_type);
