-- Delivery mode on cafes
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(20) DEFAULT 'self';
  -- 'self' = cafe's own riders
  -- 'third_party' = Dunzo / Porter / Shadowfax / Wefast
  -- 'both' = self + third_party

-- Rider pool for self-managed delivery
CREATE TABLE IF NOT EXISTS cafe_riders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id      UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  phone        VARCHAR(20),
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Third-party delivery platform credentials (per cafe)
CREATE TABLE IF NOT EXISTS cafe_delivery_platforms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id      UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  platform     VARCHAR(30) NOT NULL, -- 'dunzo' | 'porter' | 'shadowfax' | 'wefast' | 'other'
  display_name VARCHAR(60),          -- custom label for 'other'
  api_key      TEXT,
  api_secret   TEXT,
  webhook_url  TEXT,                 -- platform's callback URL for status updates
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cafe_id, platform)
);

-- Link orders to self-managed riders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rider_id UUID REFERENCES cafe_riders(id);
