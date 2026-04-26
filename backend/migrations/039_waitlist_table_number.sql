-- Migration 039: Add table_number to waitlist so owners can tell customers where to sit
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS table_number TEXT;
