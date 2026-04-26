-- Migration 041: Performance indexes for production traffic
-- All indexes use IF NOT EXISTS — safe to run on a live DB with zero downtime.
-- A CREATE INDEX does not lock reads or writes on Postgres 11+.

-- ── Orders ─────────────────────────────────────────────────────────────────
-- Most-used query: owner dashboard, KDS, and Bills tab all filter by cafe_id + status
CREATE INDEX IF NOT EXISTS idx_orders_cafe_status_created
  ON orders(cafe_id, status, created_at DESC);

-- Order deduplication lookup — used on every customer order placement
CREATE INDEX IF NOT EXISTS idx_orders_client_order_id
  ON orders(client_order_id)
  WHERE client_order_id IS NOT NULL;

-- Customer order tracking (getOrderStatus polling)
CREATE INDEX IF NOT EXISTS idx_orders_cafe_id_created
  ON orders(cafe_id, created_at DESC);

-- ── Order Items ─────────────────────────────────────────────────────────────
-- Every order load joins order_items on order_id — this is hit on every page load
CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON order_items(order_id);

-- ── Menu ────────────────────────────────────────────────────────────────────
-- Customer menu load: filters by cafe_id + is_available
CREATE INDEX IF NOT EXISTS idx_menu_items_cafe_available
  ON menu_items(cafe_id, is_available);

-- Stock tracking: inventory page sorts by stock_quantity
CREATE INDEX IF NOT EXISTS idx_menu_items_cafe_track_stock
  ON menu_items(cafe_id, track_stock)
  WHERE track_stock = true;

-- ── Notifications ────────────────────────────────────────────────────────────
-- Owner notification bell: unread count per café
CREATE INDEX IF NOT EXISTS idx_notifications_cafe_unread
  ON notifications(cafe_id, is_read, created_at DESC);

-- ── Reservations ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reservations_cafe_status
  ON reservations(cafe_id, status, reserved_at DESC);

-- ── Waitlist ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_waitlist_cafe_status
  ON waitlist_entries(cafe_id, status, created_at ASC);

-- ── OTP codes cleanup ───────────────────────────────────────────────────────
-- Periodic cleanup query: DELETE WHERE expires_at < NOW()
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires_at
  ON otp_codes(expires_at);
