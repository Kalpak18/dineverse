-- Per-item configurable low-stock alert threshold (default 5)
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 1);
