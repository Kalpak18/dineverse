-- Platform-funded offers + owner offer improvements
-- Adds:
--   1. Extend `offers` (owner) with date range, caps, new types
--   2. `platform_offers` — DineVerse admin-created campaigns
--   3. `platform_offer_cafes` — targeting (all cafes vs specific list)
--   4. `orders.platform_offer_id`, `orders.platform_discount_amount`

-- ── 1. Extend owner offers ────────────────────────────────────────
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS start_date          DATE,
  ADD COLUMN IF NOT EXISTS end_date            DATE,
  ADD COLUMN IF NOT EXISTS max_uses            INTEGER,       -- NULL = unlimited
  ADD COLUMN IF NOT EXISTS uses_count          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_discount_amount NUMERIC(10,2), -- cap on ₹ saved
  ADD COLUMN IF NOT EXISTS bogo_item_id        UUID REFERENCES menu_items(id) ON DELETE SET NULL;

-- Extend offer_type to support bogo and first_order
-- (existing check constraint may not exist; safe to drop and recreate)
ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_offer_type_check;
ALTER TABLE offers ADD CONSTRAINT offers_offer_type_check
  CHECK (offer_type IN ('percentage', 'fixed', 'combo', 'bogo', 'first_order'));

-- ── 2. Platform offers ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_offers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(120) NOT NULL,
  description         TEXT,
  offer_type          VARCHAR(20) NOT NULL CHECK (offer_type IN ('percentage', 'fixed', 'first_order')),
  discount_value      NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_discount_amount NUMERIC(10,2),           -- cap (e.g. max ₹100 off on 20% deal)
  coupon_code         VARCHAR(30) UNIQUE,       -- optional; NULL = auto-apply
  min_order_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  target_type         VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (target_type IN ('all', 'specific')),
  active_days         INTEGER[],                -- NULL = all days; [0..6]
  active_from         TIME,
  active_until        TIME,
  start_date          DATE,
  end_date            DATE,
  max_uses            INTEGER,                  -- NULL = unlimited (across all cafes)
  uses_count          INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Platform offer café targeting ─────────────────────────────
CREATE TABLE IF NOT EXISTS platform_offer_cafes (
  platform_offer_id UUID NOT NULL REFERENCES platform_offers(id) ON DELETE CASCADE,
  cafe_id           UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  PRIMARY KEY (platform_offer_id, cafe_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_offer_cafes_cafe
  ON platform_offer_cafes (cafe_id);

-- ── 4. Track platform discount on orders ─────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS platform_offer_id       UUID REFERENCES platform_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS platform_discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Index for fast commission-netting queries
CREATE INDEX IF NOT EXISTS idx_orders_platform_discount
  ON orders (cafe_id, platform_discount_amount, status)
  WHERE status = 'paid' AND platform_discount_amount > 0;
