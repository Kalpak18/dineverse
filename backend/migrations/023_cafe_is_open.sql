-- Add is_open toggle to cafes — owner can manually open/close their café
ALTER TABLE cafes ADD COLUMN IF NOT EXISTS is_open BOOLEAN NOT NULL DEFAULT true;
