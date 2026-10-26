-- Migration 079: Kitchen station per menu category (e.g. "Bar", "Tandoor").
-- Station screens on the KDS (?station=bar) show only their own lines.
-- NULL = main kitchen. Subcategories inherit the parent's station.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS station VARCHAR(40);
