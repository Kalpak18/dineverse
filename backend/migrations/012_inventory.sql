-- Migration 012: Inventory tracking on menu items
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS track_stock    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS stock_quantity INTEGER;
-- stock_quantity NULL means unlimited; 0 = sold out
