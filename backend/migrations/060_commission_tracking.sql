-- Commission tracking: record how each order's commission is handled.
--
-- commission_status lifecycle:
--   pending        → order not yet paid (default)
--   auto_deducted  → Razorpay transfer sent to café (online payment) — commission stays with DineVerse
--   transfer_failed→ Razorpay transfer attempted but failed — treat as cash_due
--   cash_due       → cash/UPI/card paid in-person; café owes commission to DineVerse
--   collected      → admin confirmed commission received from café (for cash_due / transfer_failed)
--   waived         → commission waived for this order

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_mode         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS commission_status    VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS razorpay_transfer_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS commission_collected_at TIMESTAMPTZ;

-- Fast lookup: admin querying pending cash commissions per café
CREATE INDEX IF NOT EXISTS idx_orders_commission_cash_due
  ON orders (cafe_id, commission_status, created_at)
  WHERE commission_status = 'cash_due';

-- Fast lookup: monthly settlement totals
CREATE INDEX IF NOT EXISTS idx_orders_commission_status
  ON orders (cafe_id, commission_status);

-- Commission settlement records: one row per café per settlement period.
-- Admin creates these when a café pays their outstanding cash commission.
CREATE TABLE IF NOT EXISTS commission_settlements (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id           UUID          NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  period_from       DATE          NOT NULL,
  period_to         DATE          NOT NULL,
  orders_count      INTEGER       NOT NULL DEFAULT 0,
  total_gmv         NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_commission   NUMERIC(10,2) NOT NULL DEFAULT 0,
  online_commission NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_commission  NUMERIC(10,2) NOT NULL DEFAULT 0,
  status            VARCHAR(20)   NOT NULL DEFAULT 'pending',
  settled_at        TIMESTAMPTZ,
  payment_reference TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_settlements_cafe
  ON commission_settlements (cafe_id, status, period_from);
