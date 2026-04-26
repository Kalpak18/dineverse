-- Migration 040: Add coupon_code to offers for manual redemption
ALTER TABLE offers ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(30);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_coupon_code ON offers(cafe_id, coupon_code) WHERE coupon_code IS NOT NULL;
