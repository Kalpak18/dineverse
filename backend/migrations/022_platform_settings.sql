-- Migration 022: Platform settings (admin-controlled key/value config)
-- Allows admin to change category emojis, announcements, etc. without code changes.

CREATE TABLE IF NOT EXISTS platform_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB        NOT NULL,
  label       VARCHAR(200),
  description VARCHAR(500),
  is_public   BOOLEAN      DEFAULT false,
  updated_by  UUID,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed: default category emoji map
INSERT INTO platform_settings (key, value, label) VALUES (
  'category_emoji_map',
  '{
    "momos":      "🥟",
    "pizza":      "🍕",
    "burger":     "🍔",
    "biryani":    "🍚",
    "rice":       "🍚",
    "noodle":     "🍜",
    "pasta":      "🍝",
    "soup":       "🥣",
    "salad":      "🥗",
    "chicken":    "🍗",
    "fish":       "🐟",
    "seafood":    "🦐",
    "sandwich":   "🥪",
    "wrap":       "🌯",
    "roll":       "🌯",
    "curry":      "🍛",
    "dal":        "🍲",
    "snack":      "🍟",
    "starter":    "🥗",
    "bread":      "🫓",
    "roti":       "🫓",
    "naan":       "🫓",
    "dessert":    "🍰",
    "cake":       "🎂",
    "ice cream":  "🍦",
    "shake":      "🥤",
    "juice":      "🧃",
    "coffee":     "☕",
    "tea":        "🍵",
    "drink":      "🥤",
    "beverage":   "🥤",
    "main":       "🍛",
    "breakfast":  "🥞",
    "thali":      "🍱",
    "tikka":      "🍢",
    "kebab":      "🍢",
    "paneer":     "🧀",
    "veg":        "🥦",
    "egg":        "🥚",
    "mutton":     "🍖"
  }',
  'Category Emoji Map'
) ON CONFLICT (key) DO NOTHING;

-- Seed: platform announcement (empty by default)
INSERT INTO platform_settings (key, value, label) VALUES (
  'announcement',
  '{"text": "", "active": false, "type": "info"}',
  'Platform Announcement'
) ON CONFLICT (key) DO NOTHING;
