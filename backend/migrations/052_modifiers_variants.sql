-- ─── Modifier Groups (Add-ons, Spice Level, Extras) ────────────
CREATE TABLE IF NOT EXISTS modifier_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id        UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,   -- "Spice Level", "Add-ons", "Cooking preference"
  selection_type VARCHAR(20)  DEFAULT 'single', -- 'single' (radio) | 'multiple' (checkbox)
  is_required    BOOLEAN      DEFAULT false,
  min_selections SMALLINT     DEFAULT 0,
  max_selections SMALLINT     DEFAULT 1,
  sort_order     SMALLINT     DEFAULT 0,
  created_at     TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS modifier_options (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,  -- "Extra Cheese", "Hot", "No Onion"
  price        NUMERIC(10,2) DEFAULT 0,
  sort_order   SMALLINT      DEFAULT 0,
  is_available BOOLEAN       DEFAULT true
);

-- Which modifier groups apply to which menu items
CREATE TABLE IF NOT EXISTS item_modifier_groups (
  item_id   UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  group_id  UUID NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order SMALLINT DEFAULT 0,
  PRIMARY KEY (item_id, group_id)
);

-- ─── Item Variants (Half/Full, S/M/L) ───────────────────────
CREATE TABLE IF NOT EXISTS item_variants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name         VARCHAR(50)   NOT NULL,  -- "Small", "Half", "Regular", "Large"
  price        NUMERIC(10,2) NOT NULL,
  sort_order   SMALLINT      DEFAULT 0,
  is_available BOOLEAN       DEFAULT true
);

-- Store selected modifiers + variant on each order item
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS variant_id         UUID REFERENCES item_variants(id),
  ADD COLUMN IF NOT EXISTS variant_name       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS selected_modifiers JSONB          DEFAULT '[]',
  -- Format: [{ group_id, group_name, option_id, option_name, price }]
  ADD COLUMN IF NOT EXISTS modifier_total     NUMERIC(10,2)  DEFAULT 0;
