-- Migration 081: "Call waiter" / "Request bill" from the customer's table.
CREATE TABLE IF NOT EXISTS service_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id         UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders(id) ON DELETE CASCADE,
  table_number    TEXT,
  table_verified  BOOLEAN NOT NULL DEFAULT TRUE,
  type            VARCHAR(10) NOT NULL CHECK (type IN ('waiter', 'bill')),
  status          VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_service_requests_open ON service_requests (cafe_id, status, created_at);
