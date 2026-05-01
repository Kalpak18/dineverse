const db           = require('../config/database');
const { ok }       = require('../utils/respond');
const asyncHandler  = require('../utils/asyncHandler');

// Owner: unique customer list with spend + visit stats
exports.getCustomers = asyncHandler(async (req, res) => {
  const { search = '', limit = 50, offset = 0 } = req.query;
  const q = `%${search.toLowerCase()}%`;

  const result = await db.query(
    `SELECT
       -- Most recent name as canonical display name
       (ARRAY_AGG(customer_name ORDER BY created_at DESC))[1]          AS customer_name,
       -- Most recent phone (non-null preferred)
       (ARRAY_AGG(customer_phone ORDER BY CASE WHEN customer_phone IS NOT NULL THEN 0 ELSE 1 END, created_at DESC))[1]
                                                                        AS customer_phone,
       COUNT(*)                                                         AS total_orders,
       COUNT(*) FILTER (WHERE status = 'paid')                         AS paid_orders,
       COALESCE(SUM(final_amount) FILTER (WHERE status = 'paid'), 0)   AS total_spend,
       MAX(created_at)                                                  AS last_visit,
       MIN(created_at)                                                  AS first_visit,
       COUNT(DISTINCT DATE(created_at))                                 AS visit_days,
       MODE() WITHIN GROUP (ORDER BY order_type)                       AS preferred_type
     FROM orders
     WHERE cafe_id = $1
       AND ($2 = '%%' OR LOWER(customer_name) LIKE $2 OR customer_phone LIKE $2)
     GROUP BY
       -- Phone is the identity key when available; name is fallback for walk-ins.
       -- COALESCE means different name spellings with the same phone → one customer.
       COALESCE(customer_phone, LOWER(TRIM(customer_name)))
     ORDER BY total_orders DESC, last_visit DESC
     LIMIT $3 OFFSET $4`,
    [req.cafeId, q, parseInt(limit), parseInt(offset)]
  );

  // Total unique count for pagination
  const countRes = await db.query(
    `SELECT COUNT(DISTINCT COALESCE(customer_phone, LOWER(TRIM(customer_name)))) AS total
     FROM orders WHERE cafe_id = $1`,
    [req.cafeId]
  );

  ok(res, {
    customers: result.rows,
    total: parseInt(countRes.rows[0].total),
  });
});

// Owner: single customer order history
exports.getCustomerOrders = asyncHandler(async (req, res) => {
  const { phone, name } = req.query;
  const result = await db.query(
    `SELECT id, order_type, table_number, status, total_amount, final_amount,
            COALESCE(daily_order_number, order_number) AS daily_order_number,
            created_at, notes
     FROM orders
     WHERE cafe_id = $1
       AND ($2::text IS NULL OR customer_phone = $2)
       AND ($3::text IS NULL OR LOWER(TRIM(customer_name)) = LOWER(TRIM($3)))
     ORDER BY created_at DESC
     LIMIT 30`,
    [req.cafeId, phone || null, name || null]
  );
  ok(res, { orders: result.rows });
});
