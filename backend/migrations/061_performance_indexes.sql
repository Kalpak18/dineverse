-- 061 Performance indexes
-- Adds missing indexes on tables that power high-frequency queries.
-- Uses plain CREATE INDEX (not CONCURRENTLY) so it runs inside a transaction.

-- ── Modifier & variant tables (hit on every order creation) ──────────────────
CREATE INDEX IF NOT EXISTS idx_modifier_groups_cafe_id
  ON modifier_groups(cafe_id);

CREATE INDEX IF NOT EXISTS idx_modifier_options_group_id
  ON modifier_options(group_id);

CREATE INDEX IF NOT EXISTS idx_item_variants_item_id
  ON item_variants(item_id);

CREATE INDEX IF NOT EXISTS idx_item_modifier_groups_item_id
  ON item_modifier_groups(item_id);

CREATE INDEX IF NOT EXISTS idx_item_modifier_groups_group_id
  ON item_modifier_groups(group_id);

CREATE INDEX IF NOT EXISTS idx_category_modifier_groups_category_id
  ON category_modifier_groups(category_id);

-- ── Orders: commission & payment mode queries ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_commission_status_cafe
  ON orders(cafe_id, commission_status)
  WHERE commission_status IN ('cash_due', 'auto_deducted');

CREATE INDEX IF NOT EXISTS idx_orders_payment_mode
  ON orders(cafe_id, payment_mode);

-- ── Orders: delivery tracking ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status
  ON orders(cafe_id, delivery_status)
  WHERE delivery_status IS NOT NULL;

-- ── Waitlist: owner list view ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_waitlist_cafe_status
  ON waitlist(cafe_id, status, created_at ASC);

-- ── Commission settlements ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_commission_settlements_cafe_status
  ON commission_settlements(cafe_id, status);
