-- Add 'waiter' to the staff role allowlist
-- Previous constraint only had: cashier, kitchen, manager
ALTER TABLE cafe_staff DROP CONSTRAINT IF EXISTS cafe_staff_role_check;
ALTER TABLE cafe_staff
  ADD CONSTRAINT cafe_staff_role_check
  CHECK (role IN ('cashier', 'kitchen', 'manager', 'waiter'));
