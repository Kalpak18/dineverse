-- Migration 013: Combos & Offers
CREATE TABLE IF NOT EXISTS offers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id          UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  name             VARCHAR(100) NOT NULL,
  description      TEXT,
  -- 'percentage' | 'fixed' | 'combo'
  offer_type       VARCHAR(20) NOT NULL CHECK (offer_type IN ('percentage','fixed','combo')),
  discount_value   DECIMAL(10,2) NOT NULL DEFAULT 0,  -- % or ₹ off; 0 for combo
  combo_items      JSONB,          -- [{menu_item_id, quantity}] for combo type
  combo_price      DECIMAL(10,2),  -- special bundle price for combo
  min_order_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- Time-of-day restriction (NULL = all day)
  active_from      TIME,
  active_until     TIME,
  -- Days of week restriction: array of 0-6 (0=Sun). NULL = every day
  active_days      INTEGER[],
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_offers_cafe_id ON offers(cafe_id);

-- Add discount columns to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS offer_id        UUID REFERENCES offers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_amount    DECIMAL(10,2);
-- Backfill final_amount for existing orders
UPDATE orders SET final_amount = total_amount WHERE final_amount IS NULL;
