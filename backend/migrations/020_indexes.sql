-- Migration 020: Performance indexes
-- Covers the most common query patterns: filter by cafe, status, date, customer lookup.

-- orders — the hottest table
CREATE INDEX IF NOT EXISTS idx_orders_cafe_id         ON orders(cafe_id);
CREATE INDEX IF NOT EXISTS idx_orders_cafe_status      ON orders(cafe_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_cafe_created     ON orders(cafe_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_client_order_id  ON orders(client_order_id) WHERE client_order_id IS NOT NULL;

-- order_items — joined on every order fetch
CREATE INDEX IF NOT EXISTS idx_order_items_order_id    ON order_items(order_id);

-- menu_items — filtered by cafe on every order/menu load
CREATE INDEX IF NOT EXISTS idx_menu_items_cafe_id      ON menu_items(cafe_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_cafe_avail   ON menu_items(cafe_id, is_available);

-- expenses — filtered by cafe + date in analytics
CREATE INDEX IF NOT EXISTS idx_expenses_cafe_id        ON expenses(cafe_id);
CREATE INDEX IF NOT EXISTS idx_expenses_cafe_date      ON expenses(cafe_id, expense_date DESC);

-- order_ratings indexes already created in migration 011
-- reservations indexes already created in migration 014

-- otp_codes — cleanup job and verify lookup
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires       ON otp_codes(expires_at);
