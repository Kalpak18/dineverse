-- Migration 027: Tax snapshot on orders + legal/compliance fields on cafes

-- Store per-order tax snapshot (never recalculate after the fact)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tax_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate     SMALLINT      NOT NULL DEFAULT 0;

-- Extra business/legal fields on cafes
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS pan_number     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS tax_inclusive  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gst_verified   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_type  VARCHAR(50) NOT NULL DEFAULT 'restaurant',
  ADD COLUMN IF NOT EXISTS country        VARCHAR(50) NOT NULL DEFAULT 'India';

-- Index so revenue/tax reports by cafe are fast
CREATE INDEX IF NOT EXISTS idx_orders_cafe_tax ON orders(cafe_id, tax_rate, created_at DESC);
