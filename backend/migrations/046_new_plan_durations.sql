-- Add short-duration plan keys (1-month, 3-month, 6-month) and cancelled payment status
-- Safe to re-run: uses IF NOT EXISTS / DROP CONSTRAINT IF EXISTS

-- 1. Update cafes.plan_type constraint to allow new plan keys
ALTER TABLE cafes DROP CONSTRAINT IF EXISTS cafes_plan_type_check;
ALTER TABLE cafes ADD CONSTRAINT cafes_plan_type_check
  CHECK (plan_type IN (
    'free_trial', 'yearly', 'two_year', 'three_year',
    '1year', '2year', '3year',
    'basic_1month', 'basic_3month', 'basic_6month',
    'basic_1year', 'basic_2year', 'basic_3year',
    'premium_1month', 'premium_3month', 'premium_6month',
    'premium_1year', 'premium_2year', 'premium_3year'
  ));

-- 2. Update payments.status constraint to allow 'cancelled' status
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'completed', 'failed', 'cancelled'));
