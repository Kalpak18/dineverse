-- Migration 072: Per-customer offer limits and redemption tracking

-- Add per-customer limit columns to both offer tables
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS max_uses_per_customer INTEGER;  -- NULL = unlimited per customer

ALTER TABLE platform_offers
  ADD COLUMN IF NOT EXISTS max_uses_per_customer INTEGER;

-- Redemption log: one row per (offer, customer_phone, order)
-- Enables enforcing per-customer limits and showing usage stats.
CREATE TABLE IF NOT EXISTS offer_redemptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id         UUID REFERENCES offers(id) ON DELETE CASCADE,
  platform_offer_id UUID REFERENCES platform_offers(id) ON DELETE CASCADE,
  order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  cafe_id          UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  customer_phone   VARCHAR(20),
  discount_amount  DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CHECK (
    (offer_id IS NOT NULL AND platform_offer_id IS NULL) OR
    (offer_id IS NULL AND platform_offer_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_offer_redemptions_offer_id ON offer_redemptions(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_redemptions_platform_offer_id ON offer_redemptions(platform_offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_redemptions_customer_phone ON offer_redemptions(customer_phone);
CREATE INDEX IF NOT EXISTS idx_offer_redemptions_cafe_id ON offer_redemptions(cafe_id);

-- No backfill: per-customer usage tracking starts from this migration forward.
-- Historical orders are not counted toward per-customer limits.
