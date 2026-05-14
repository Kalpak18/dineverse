-- 068_rider_self_registration.sql
-- Extends cafe_riders to support self-registration, region preferences,
-- availability toggling, earnings tracking, and delivery history.

-- ── Self-registration fields ─────────────────────────────────────────────────
ALTER TABLE cafe_riders
  ADD COLUMN IF NOT EXISTS is_self_registered  BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS registration_status VARCHAR(20)  NOT NULL DEFAULT 'active'
    CHECK (registration_status IN ('pending', 'active', 'suspended')),

  -- Rider's home/base location (used for 7–10 km radius filtering)
  ADD COLUMN IF NOT EXISTS base_lat            DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS base_lng            DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS base_address        TEXT,
  ADD COLUMN IF NOT EXISTS service_radius_km   DECIMAL(5,2)  NOT NULL DEFAULT 10.0,

  -- Availability toggle (rider goes online/offline)
  ADD COLUMN IF NOT EXISTS is_online           BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Vehicle info
  ADD COLUMN IF NOT EXISTS vehicle_type        VARCHAR(30)  DEFAULT 'bike'
    CHECK (vehicle_type IN ('bike', 'scooter', 'bicycle', 'car', 'van')),
  ADD COLUMN IF NOT EXISTS vehicle_number      VARCHAR(20),

  -- Earnings snapshot (updated on each delivery completion)
  ADD COLUMN IF NOT EXISTS total_deliveries    INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_earnings      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS today_deliveries    INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS today_earnings      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS earnings_date       DATE,         -- date today_* was last reset

  -- Profile
  ADD COLUMN IF NOT EXISTS profile_photo_url   TEXT,
  ADD COLUMN IF NOT EXISTS bio                 TEXT,

  -- For self-registered riders cafe_id is NULL until they accept a job from a cafe
  ALTER COLUMN cafe_id DROP NOT NULL;

-- Allow NULL cafe_id (self-registered riders not tied to one cafe)
-- Already handled by ALTER COLUMN above

-- Index for nearby-order queries (lat/lng range scan)
CREATE INDEX IF NOT EXISTS idx_cafe_riders_base_location
  ON cafe_riders (base_lat, base_lng)
  WHERE base_lat IS NOT NULL AND base_lng IS NOT NULL;

-- Index for online riders lookup
CREATE INDEX IF NOT EXISTS idx_cafe_riders_online
  ON cafe_riders (is_online, is_active)
  WHERE is_online = TRUE;

-- ── Per-order earnings ledger ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rider_earnings (
  id            SERIAL PRIMARY KEY,
  rider_id      INTEGER      NOT NULL REFERENCES cafe_riders(id) ON DELETE CASCADE,
  order_id      INTEGER      NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  cafe_id       INTEGER      REFERENCES cafes(id) ON DELETE SET NULL,
  cafe_name     VARCHAR(200),
  delivery_fee  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  tip_amount    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total_earned  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  distance_km   DECIMAL(6,2),
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled')),
  earned_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (rider_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_rider_earnings_rider_id  ON rider_earnings (rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_earnings_earned_at ON rider_earnings (earned_at DESC);

-- ── Nearby-orders view (orders pending delivery within a radius) ──────────────
-- Not a real view — we'll do the haversine calc in the controller.
-- Just ensure orders have an index on delivery coords + status.
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status
  ON orders (delivery_status, delivery_lat, delivery_lng)
  WHERE delivery_lat IS NOT NULL AND order_type = 'delivery';
