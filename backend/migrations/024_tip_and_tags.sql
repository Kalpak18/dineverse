-- Tip amount on orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Allergen/dietary tags on menu items (stored as text array)
-- e.g. '{vegan,gluten-free,nuts,dairy,egg,spicy}'
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
