-- Allow 'seated' status: reservation is confirmed and customer has arrived and placed an order
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('pending','confirmed','seated','cancelled','completed','no_show'));

-- Link reservation → the order placed by the arrived customer
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS order_id INTEGER;

-- Link order → the reservation it fulfilled (owner sees 🔖 badge)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_id INTEGER;
