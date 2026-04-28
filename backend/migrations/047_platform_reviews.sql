-- Platform reviews: café owners review the DineVerse platform
-- One review per café, auto-approved. Admin can hide by setting is_approved = false.

CREATE TABLE IF NOT EXISTS platform_reviews (
  id              SERIAL PRIMARY KEY,
  cafe_id         INTEGER NOT NULL,
  cafe_name       TEXT NOT NULL,
  owner_name      TEXT NOT NULL,
  city            TEXT,
  state           TEXT,
  rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title           TEXT,
  review_text     TEXT NOT NULL CHECK (char_length(review_text) BETWEEN 10 AND 600),
  is_approved     BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_reviews_cafe_id_key ON platform_reviews(cafe_id);
CREATE INDEX IF NOT EXISTS platform_reviews_approved_idx ON platform_reviews(is_approved, created_at DESC);
