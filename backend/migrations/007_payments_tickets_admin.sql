-- ============================================================
-- DineVerse Migration 007: Payments, Support Tickets, Developers
-- ============================================================

-- ── Payments (Razorpay subscription receipts) ────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cafe_id              UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  razorpay_order_id    VARCHAR(100) NOT NULL UNIQUE,
  razorpay_payment_id  VARCHAR(100),
  razorpay_signature   VARCHAR(500),
  amount_paise         INT NOT NULL,           -- amount in paise (₹2999 = 299900)
  plan_type            VARCHAR(20) NOT NULL,   -- 'yearly'
  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'completed', 'failed')),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_cafe_id ON payments(cafe_id);
CREATE INDEX IF NOT EXISTS idx_payments_status  ON payments(status);

-- ── Support Tickets ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cafe_id      UUID REFERENCES cafes(id) ON DELETE SET NULL,
  cafe_name    VARCHAR(255) NOT NULL,
  cafe_email   VARCHAR(255) NOT NULL,
  subject      VARCHAR(255) NOT NULL,
  message      TEXT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'in_progress', 'resolved')),
  admin_reply  TEXT,
  replied_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_cafe_id ON support_tickets(cafe_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status  ON support_tickets(status);

CREATE TRIGGER update_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Developers (Admin accounts) ──────────────────────────────
CREATE TABLE IF NOT EXISTS developers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
