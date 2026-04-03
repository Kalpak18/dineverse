-- Add subscription/plan columns to cafes table
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20) NOT NULL DEFAULT 'free_trial',
  ADD COLUMN IF NOT EXISTS plan_start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_expiry_date TIMESTAMPTZ;

ALTER TABLE cafes DROP CONSTRAINT IF EXISTS cafes_plan_type_check;
ALTER TABLE cafes ADD CONSTRAINT cafes_plan_type_check
  CHECK (plan_type IN ('free_trial', 'yearly', 'two_year', 'three_year'));

-- Backfill existing cafes: free trial starting from account creation
UPDATE cafes
SET
  plan_start_date  = created_at,
  plan_expiry_date = created_at + INTERVAL '1 month'
WHERE plan_start_date IS NULL;
