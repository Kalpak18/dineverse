-- Delivery support: add 'delivery' order type + delivery fields on orders + delivery config on cafes

-- 1. Extend order_type CHECK constraint to include 'delivery'
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check
  CHECK (order_type IN ('dine-in', 'takeaway', 'delivery'));

-- 2. Delivery address + logistics fields on orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_address        TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address2       TEXT,
  ADD COLUMN IF NOT EXISTS delivery_city           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS delivery_zipcode        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS delivery_phone          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS delivery_lat            DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS delivery_lng            DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS delivery_instructions   TEXT,
  ADD COLUMN IF NOT EXISTS delivery_fee            NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_status         VARCHAR(30)
                             CHECK (delivery_status IN (
                               'pending','assigned','picked_up','out_for_delivery','delivered','failed'
                             )),
  ADD COLUMN IF NOT EXISTS delivery_partner_order_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS driver_name             VARCHAR(100),
  ADD COLUMN IF NOT EXISTS driver_phone            VARCHAR(20),
  ADD COLUMN IF NOT EXISTS driver_lat              DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS driver_lng              DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS delivery_partner        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS delivered_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_failed_reason  TEXT;

-- 3. Delivery config on cafes
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS delivery_enabled        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_radius_km      NUMERIC(5,2) DEFAULT 5,
  ADD COLUMN IF NOT EXISTS delivery_fee_base       NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_per_km     NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_min_order      NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_est_mins       SMALLINT DEFAULT 30;
