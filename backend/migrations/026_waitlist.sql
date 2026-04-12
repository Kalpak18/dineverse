-- Waitlist: customers queue when no table is available
CREATE TABLE IF NOT EXISTS waitlist (
  id             SERIAL PRIMARY KEY,
  cafe_id        INTEGER NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT,
  party_size     INTEGER NOT NULL DEFAULT 1,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'waiting'
                   CHECK (status IN ('waiting', 'seated', 'cancelled', 'no_show')),
  notified_at    TIMESTAMP WITH TIME ZONE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_cafe_status ON waitlist(cafe_id, status);
