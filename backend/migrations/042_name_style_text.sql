-- Migration 042: Widen name_style from VARCHAR(20) to TEXT
-- The column now stores JSON objects like {"fontFamily":"inherit","fontSize":18,...}
-- which exceed the original 20-char limit designed for 'normal'/'bold'/'italic' values.
ALTER TABLE cafes ALTER COLUMN name_style TYPE TEXT;
