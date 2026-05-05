-- Category-level modifier groups.
-- Groups attached here apply to every item in the category. Item-level groups
-- are still supported and duplicate group links are collapsed at read time.
CREATE TABLE IF NOT EXISTS category_modifier_groups (
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  group_id    UUID NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order  SMALLINT DEFAULT 0,
  PRIMARY KEY (category_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_category_modifier_groups_category_id
  ON category_modifier_groups(category_id);
