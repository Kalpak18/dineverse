-- Add role to cafe_staff (cashier | kitchen | manager)
ALTER TABLE cafe_staff
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'cashier'
    CHECK (role IN ('cashier', 'kitchen', 'manager'));
