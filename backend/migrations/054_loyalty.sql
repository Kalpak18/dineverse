-- ─── Loyalty Program ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty_programs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id               UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE UNIQUE,
  points_per_rupee      NUMERIC(6,2) DEFAULT 1,     -- points earned per ₹ spent
  rupees_per_point      NUMERIC(6,4) DEFAULT 0.1,   -- redemption value per point (10 pts = ₹1)
  min_points_redeem     INT          DEFAULT 100,    -- minimum points needed to redeem
  max_redeem_pct        SMALLINT     DEFAULT 20,     -- max % of bill redeemable with points
  points_expiry_days    INT          DEFAULT 365,    -- 0 = never expire
  is_active             BOOLEAN      DEFAULT true,
  program_name          VARCHAR(100) DEFAULT 'Loyalty Points',
  created_at            TIMESTAMPTZ  DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_points (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id          UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  customer_phone   VARCHAR(20)  NOT NULL,
  customer_name    VARCHAR(100),
  points_balance   INT          DEFAULT 0,
  total_earned     INT          DEFAULT 0,
  total_redeemed   INT          DEFAULT 0,
  last_activity    TIMESTAMPTZ  DEFAULT NOW(),
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(cafe_id, customer_phone)
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id        UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  customer_phone VARCHAR(20) NOT NULL,
  order_id       UUID REFERENCES orders(id) ON DELETE SET NULL,
  type           VARCHAR(20) NOT NULL,  -- 'earn' | 'redeem' | 'expire' | 'adjustment'
  points         INT         NOT NULL,  -- positive = earned, negative = redeemed/expired
  order_amount   NUMERIC(10,2),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_points_cafe_phone ON customer_points(cafe_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_phone ON loyalty_transactions(cafe_id, customer_phone);

-- Add loyalty columns to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS loyalty_points_earned   INT          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_points_redeemed INT          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_discount        NUMERIC(10,2) DEFAULT 0;
