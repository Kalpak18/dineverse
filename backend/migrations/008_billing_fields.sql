-- Add billing/receipt fields to cafes
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS gst_number     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS gst_rate       SMALLINT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS fssai_number   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS upi_id         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS email          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS bill_prefix    VARCHAR(10) NOT NULL DEFAULT 'INV',
  ADD COLUMN IF NOT EXISTS bill_footer    TEXT;

-- gst_rate: 0 = not registered / composition, 5 = standard restaurant, 18 = AC + liquor / 5-star
