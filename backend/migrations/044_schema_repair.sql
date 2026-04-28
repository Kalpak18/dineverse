-- Migration 044: Schema repair — safely re-adds any columns that may have been
-- dropped by manual DB edits. All statements use IF NOT EXISTS so this is safe
-- to run on a fully intact DB (nothing changes if columns already exist).

-- ── orders ──────────────────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS daily_order_number    INT,
  ADD COLUMN IF NOT EXISTS discount_amount       NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tip_amount            NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_amount          NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tax_amount            NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate              NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_reason   TEXT,
  ADD COLUMN IF NOT EXISTS client_order_id       VARCHAR(64),
  ADD COLUMN IF NOT EXISTS accepted              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acceptance_time       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_id              UUID REFERENCES offers(id) ON DELETE SET NULL,
  -- delivery fields
  ADD COLUMN IF NOT EXISTS delivery_address      TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address2     TEXT,
  ADD COLUMN IF NOT EXISTS delivery_city         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS delivery_zipcode      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS delivery_phone        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS delivery_lat          DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS delivery_lng          DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS delivery_instructions TEXT,
  ADD COLUMN IF NOT EXISTS delivery_fee          NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_status       VARCHAR(30),
  ADD COLUMN IF NOT EXISTS delivery_partner_order_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS driver_name           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS driver_phone          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS driver_lat            DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS driver_lng            DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS delivery_partner      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS delivered_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_failed_reason TEXT,
  ADD COLUMN IF NOT EXISTS delivery_token        UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS driver_updated_at     TIMESTAMPTZ;

-- ── order_items ──────────────────────────────────────────────────────────────
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS item_status       VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sort_order        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preparing_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS served_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS accepted          BOOLEAN NOT NULL DEFAULT true;

-- ── cafes ────────────────────────────────────────────────────────────────────
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS plan_tier           VARCHAR(20) NOT NULL DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS is_open             BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS opening_hours       JSONB,
  ADD COLUMN IF NOT EXISTS timezone            VARCHAR(60) DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS latitude            DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS longitude           DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS currency            VARCHAR(10) DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS setup_completed     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_enabled    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_radius_km  NUMERIC(5,2) DEFAULT 5,
  ADD COLUMN IF NOT EXISTS delivery_fee_base   NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_per_km NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_min_order  NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_est_mins   SMALLINT DEFAULT 30;

-- ── offers ───────────────────────────────────────────────────────────────────
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(30);

CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_coupon_code
  ON offers(cafe_id, coupon_code) WHERE coupon_code IS NOT NULL;

-- ── kot_slips (re-create if dropped) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kot_slips (
  id            SERIAL PRIMARY KEY,
  cafe_id       UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  slip_number   INT NOT NULL,
  table_number  VARCHAR(50),
  customer_name VARCHAR(100),
  items         JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  printed_at    TIMESTAMPTZ,
  UNIQUE (order_id, slip_number)
);
CREATE INDEX IF NOT EXISTS idx_kot_slips_order ON kot_slips(order_id);
CREATE INDEX IF NOT EXISTS idx_kot_slips_cafe  ON kot_slips(cafe_id, created_at DESC);

-- ── order_events (re-create if dropped) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_events (
  id           SERIAL PRIMARY KEY,
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status  VARCHAR(30),
  to_status    VARCHAR(30),
  actor_type   VARCHAR(20),
  actor_name   VARCHAR(100),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);

-- ── waitlist (re-create if dropped) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waitlist (
  id            SERIAL PRIMARY KEY,
  cafe_id       UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  customer_name VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(20),
  party_size    INT DEFAULT 1,
  table_number  VARCHAR(50),
  status        VARCHAR(20) DEFAULT 'waiting',
  notes         TEXT,
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  seated_at     TIMESTAMPTZ,
  left_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_waitlist_cafe ON waitlist(cafe_id, status);
