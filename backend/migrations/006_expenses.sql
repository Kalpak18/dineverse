-- Expense tracking for profit calculation
CREATE TABLE IF NOT EXISTS expenses (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id      UUID          NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  name         VARCHAR(255)  NOT NULL,
  amount       NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  expense_date DATE          NOT NULL DEFAULT CURRENT_DATE,
  category     VARCHAR(100),
  notes        TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expenses_cafe_id_idx   ON expenses(cafe_id);
CREATE INDEX IF NOT EXISTS expenses_date_idx      ON expenses(cafe_id, expense_date);
