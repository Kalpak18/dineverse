-- Migration 083: Menu translations for customers who read Hindi / Marathi.
-- { "hi": { "name": "पनीर टिक्का", "description": "…" }, "mr": { … } }
-- Missing languages/fields fall back to the English name/description.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;
