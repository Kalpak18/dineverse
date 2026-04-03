-- Migration 001: Initial schema
-- Creates the core tables: cafes, categories, menu_items, orders, order_items
-- Uses gen_random_uuid() — available in PostgreSQL 13+ without any extension.

-- ── Utility: auto-update updated_at on any table ─────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Cafes (one row = one café / tenant) ──────────────────────
CREATE TABLE IF NOT EXISTS cafes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(100) NOT NULL,
  slug              VARCHAR(100) NOT NULL UNIQUE,
  email             VARCHAR(255) NOT NULL UNIQUE,
  password_hash     TEXT        NOT NULL,
  description       TEXT,
  address           TEXT,
  city              VARCHAR(100),
  phone             VARCHAR(20),
  logo_url          TEXT,
  cover_image_url   TEXT,
  upi_id            VARCHAR(100),
  gst_number        VARCHAR(20),
  gst_rate          SMALLINT    NOT NULL DEFAULT 5,
  fssai_number      VARCHAR(30),
  bill_prefix       VARCHAR(10),
  bill_footer       TEXT,
  plan_type         VARCHAR(20) NOT NULL DEFAULT 'free_trial'
                    CHECK (plan_type IN ('free_trial','1year','2year','3year','yearly')),
  plan_start_date   TIMESTAMPTZ,
  plan_expiry_date  TIMESTAMPTZ,
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_cafes_updated_at
  BEFORE UPDATE ON cafes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Menu categories ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id       UUID         NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  display_order SMALLINT     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_cafe_id ON categories(cafe_id);

-- ── Menu items ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id       UUID          NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  category_id   UUID          REFERENCES categories(id) ON DELETE SET NULL,
  name          VARCHAR(150)  NOT NULL,
  description   TEXT,
  price         NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  image_url     TEXT,
  is_veg        BOOLEAN       NOT NULL DEFAULT true,
  is_available  BOOLEAN       NOT NULL DEFAULT true,
  display_order SMALLINT      NOT NULL DEFAULT 0,
  track_stock   BOOLEAN       NOT NULL DEFAULT false,
  stock_quantity INTEGER,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_cafe_id    ON menu_items(cafe_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_cafe_avail ON menu_items(cafe_id, is_available);

CREATE TRIGGER update_menu_items_updated_at
  BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Orders ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id           UUID          NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  order_number      SERIAL        NOT NULL,
  customer_name     VARCHAR(100)  NOT NULL,
  customer_phone    VARCHAR(20),
  table_number      VARCHAR(20),
  order_type        VARCHAR(10)   NOT NULL DEFAULT 'dine-in'
                    CHECK (order_type IN ('dine-in','takeaway')),
  status            VARCHAR(20)   NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','preparing','ready','served','paid','cancelled')),
  total_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  final_amount      NUMERIC(10,2),
  offer_id          UUID,
  cash_received     NUMERIC(10,2),
  change_amount     NUMERIC(10,2),
  payment_mode      VARCHAR(20),
  payment_verified  BOOLEAN       NOT NULL DEFAULT false,
  daily_order_number INTEGER,
  cancellation_reason TEXT,
  client_order_id   VARCHAR(64),
  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_client_order_id_idx
  ON orders(client_order_id) WHERE client_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_cafe_id      ON orders(cafe_id);
CREATE INDEX IF NOT EXISTS idx_orders_cafe_status  ON orders(cafe_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_cafe_created ON orders(cafe_id, created_at DESC);

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Order items ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID          REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name    VARCHAR(150)  NOT NULL,
  quantity     SMALLINT      NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(10,2) NOT NULL,
  subtotal     NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
