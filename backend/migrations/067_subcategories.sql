-- Add optional parent_id to categories for subcategory support.
-- A category with parent_id = NULL is a top-level category.
-- A category with parent_id set is a subcategory of that parent.
-- Only one level of nesting is supported (subcategories cannot have children).

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
