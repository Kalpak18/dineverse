-- Backfill commission_rate: existing cafés inherited the old default of 5.00
-- from migration 059. Migration 062 lowered the default to 2.00 for NEW rows
-- but left existing rows alone, causing trust violations where the customer
-- saw "2% = ₹6" in the cart but was billed "5% = ₹15" at order placement.
--
-- This brings every existing café down to the standard 2% commission. Admins
-- who want a higher rate (e.g. 3-4% for large restaurants per the tier model)
-- can update their café individually via the admin panel.
--
-- Safe to run repeatedly — only touches the rows that match the old default.

UPDATE cafes
SET commission_rate = 2.00
WHERE commission_rate IS NULL OR commission_rate = 5.00;
