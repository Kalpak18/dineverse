-- ─── Shift / Cash Register Management ──────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id          UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  opened_by        UUID REFERENCES cafe_staff(id),
  closed_by        UUID REFERENCES cafe_staff(id),
  opening_balance  NUMERIC(10,2) DEFAULT 0,   -- cash in drawer at start
  closing_balance  NUMERIC(10,2),              -- cash in drawer at end (counted by staff)
  expected_cash    NUMERIC(10,2),              -- computed: opening + cash sales - change
  cash_sales       NUMERIC(10,2) DEFAULT 0,
  card_sales       NUMERIC(10,2) DEFAULT 0,
  upi_sales        NUMERIC(10,2) DEFAULT 0,
  other_sales      NUMERIC(10,2) DEFAULT 0,
  total_orders     INT           DEFAULT 0,
  total_revenue    NUMERIC(10,2) DEFAULT 0,
  total_discounts  NUMERIC(10,2) DEFAULT 0,
  total_refunds    NUMERIC(10,2) DEFAULT 0,
  notes            TEXT,
  status           VARCHAR(20)   DEFAULT 'open', -- 'open' | 'closed'
  opened_at        TIMESTAMPTZ   DEFAULT NOW(),
  closed_at        TIMESTAMPTZ
);

-- Link each paid order to its shift
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id);
