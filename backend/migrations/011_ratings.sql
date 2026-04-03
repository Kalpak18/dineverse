-- Migration 011: Customer order ratings
CREATE TABLE IF NOT EXISTS order_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  cafe_id     UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (order_id)  -- one rating per order
);
CREATE INDEX IF NOT EXISTS idx_order_ratings_cafe_id ON order_ratings(cafe_id);
