-- Migration 078: Race-free daily order numbers + IST as the DB timezone.

-- 1. Daily token numbers. The old trigger did MAX(daily_order_number)+1 with
--    no lock, so concurrent orders got the same kitchen token. A per-café,
--    per-day counter row updated with INSERT … ON CONFLICT serialises them.
CREATE TABLE IF NOT EXISTS cafe_daily_counters (
  cafe_id     UUID    NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  day         DATE    NOT NULL,
  last_number INTEGER NOT NULL,
  PRIMARY KEY (cafe_id, day)
);

CREATE OR REPLACE FUNCTION set_daily_order_number()
RETURNS TRIGGER AS $$
DECLARE
  tz TEXT;
  d  DATE;
BEGIN
  SELECT NULLIF(timezone, '') INTO tz FROM cafes WHERE id = NEW.cafe_id;
  BEGIN
    -- "Today" in the café's own timezone (default IST)
    d := (COALESCE(NEW.created_at, NOW()) AT TIME ZONE COALESCE(tz, 'Asia/Kolkata'))::date;
  EXCEPTION WHEN others THEN
    d := (COALESCE(NEW.created_at, NOW()) AT TIME ZONE 'Asia/Kolkata')::date;  -- bad tz string
  END;

  INSERT INTO cafe_daily_counters (cafe_id, day, last_number)
  VALUES (NEW.cafe_id, d, 1)
  ON CONFLICT (cafe_id, day) DO UPDATE SET last_number = cafe_daily_counters.last_number + 1
  RETURNING last_number INTO NEW.daily_order_number;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Seed today's counters so numbering continues from orders already placed today
INSERT INTO cafe_daily_counters (cafe_id, day, last_number)
SELECT o.cafe_id,
       (NOW() AT TIME ZONE COALESCE(NULLIF(c.timezone, ''), 'Asia/Kolkata'))::date,
       MAX(o.daily_order_number)
FROM orders o
JOIN cafes c ON c.id = o.cafe_id
WHERE (o.created_at AT TIME ZONE COALESCE(NULLIF(c.timezone, ''), 'Asia/Kolkata'))::date
    = (NOW() AT TIME ZONE COALESCE(NULLIF(c.timezone, ''), 'Asia/Kolkata'))::date
  AND o.daily_order_number IS NOT NULL
GROUP BY o.cafe_id, c.timezone
ON CONFLICT (cafe_id, day) DO UPDATE
  SET last_number = GREATEST(cafe_daily_counters.last_number, EXCLUDED.last_number);

-- 2. Session timezone. Neon defaults to UTC, so CURRENT_DATE / DATE(created_at)
--    ("today" on the dashboard, reservations, offer dates) and the reservation
--    auto-cancel (reserved_date + reserved_time < NOW()) were off by 5h30m.
--    Needs DB-owner rights; the app also SETs it per connection as a fallback.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Kolkata');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not ALTER DATABASE timezone (insufficient privilege) — relying on per-connection SET';
END;
$$;
