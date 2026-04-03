-- Migration 010: customer_phone on orders, city on cafes
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20);
ALTER TABLE cafes  ADD COLUMN IF NOT EXISTS city           VARCHAR(100);
