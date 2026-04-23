ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS setup_completed BOOLEAN NOT NULL DEFAULT true;

UPDATE cafes
SET setup_completed = true
WHERE setup_completed IS DISTINCT FROM true;
