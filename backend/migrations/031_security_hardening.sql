-- OTP attempt tracking: lock out after 3 wrong guesses
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

-- Missing indexes for performance
CREATE INDEX IF NOT EXISTS idx_order_ratings_order_id ON order_ratings(order_id);
CREATE INDEX IF NOT EXISTS idx_order_messages_cafe_id ON order_messages(cafe_id);
