-- 071 Missing performance indexes
-- Covers query patterns not addressed in earlier index migrations.

-- order_items.menu_item_id — used by stock reports, analytics, and sales queries
-- that aggregate items sold per menu item across many orders.
CREATE INDEX IF NOT EXISTS idx_order_items_menu_item_id
  ON order_items(menu_item_id);

-- offers compound index — every menu page load queries active offers by cafe.
-- Without this, Postgres falls back to the plain cafe_id index and filters is_active
-- in memory, which is slow once a cafe accumulates expired offers.
CREATE INDEX IF NOT EXISTS idx_offers_cafe_active
  ON offers(cafe_id, is_active, created_at DESC)
  WHERE is_active = true;

-- platform_offers — same pattern: active platform promos queried on menu load.
CREATE INDEX IF NOT EXISTS idx_platform_offers_active
  ON platform_offers(is_active, valid_from, valid_until)
  WHERE is_active = true;

-- otp_codes.expires_at — cleanup job and expiry check both scan this column.
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires_at
  ON otp_codes(expires_at);

-- order_events.order_id — audit log lookups by order.
CREATE INDEX IF NOT EXISTS idx_order_events_order_id
  ON order_events(order_id);
