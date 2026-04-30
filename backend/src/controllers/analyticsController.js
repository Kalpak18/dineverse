const db = require('../config/database');
const { ok } = require('../utils/respond');
const asyncHandler = require('../utils/asyncHandler');

exports.getAnalytics = asyncHandler(async (req, res) => {
  const { period = 'daily', from, to } = req.query;

  // Compute date range
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  let startDate, endDate;

  if (from && to) {
    startDate = from;
    endDate = to;
  } else {
    endDate = today;
    if (period === 'weekly') {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      startDate = d.toISOString().split('T')[0];
    } else if (period === 'monthly') {
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    } else if (period === 'yearly') {
      startDate = `${now.getFullYear()}-01-01`;
    } else {
      startDate = today; // daily
    }
  }

  const [summaryRes, expensesRes, topItemsRes, dailyRes, orderTypeRes, categoryRes,
         tableTurnRes, peakHoursRes, repeatRes] = await Promise.all([
    // Order counts — total_orders = ALL orders received (including cancelled)
    // paid_orders = only paid (matches History tab count)
    db.query(
      `SELECT
         COUNT(*)                                          AS total_orders,
         COUNT(*) FILTER (WHERE status = 'cancelled')     AS cancelled_orders,
         COUNT(*) FILTER (WHERE status = 'paid')          AS paid_orders,
         COALESCE(SUM(final_amount)  FILTER (WHERE status = 'paid'), 0) AS total_revenue,
         COALESCE(SUM(tip_amount)    FILTER (WHERE status = 'paid'), 0) AS total_tips,
         COALESCE(SUM(delivery_fee)  FILTER (WHERE status = 'paid'), 0) AS total_delivery_fees
       FROM orders
       WHERE cafe_id = $1 AND DATE(created_at) BETWEEN $2 AND $3`,
      [req.cafeId, startDate, endDate]
    ),

    // Expenses
    db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_expenses,
              json_agg(json_build_object(
                'id', id, 'name', name, 'amount', amount,
                'expense_date', expense_date, 'category', category
              ) ORDER BY expense_date DESC) AS expense_list
       FROM expenses
       WHERE cafe_id = $1 AND expense_date BETWEEN $2 AND $3`,
      [req.cafeId, startDate, endDate]
    ),

    // Top selling items
    db.query(
      `SELECT oi.item_name,
              SUM(oi.quantity) AS total_qty,
              COALESCE(SUM(oi.subtotal) FILTER (WHERE o.status = 'paid'), 0) AS total_revenue
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.cafe_id = $1
         AND DATE(o.created_at) BETWEEN $2 AND $3
         AND o.status != 'cancelled'
       GROUP BY oi.item_name
       ORDER BY total_qty DESC
       LIMIT 10`,
      [req.cafeId, startDate, endDate]
    ),

    // Daily breakdown for chart
    db.query(
      `SELECT DATE(created_at) AS date,
              COUNT(*) FILTER (WHERE status != 'cancelled') AS orders,
              COALESCE(SUM(final_amount) FILTER (WHERE status = 'paid'), 0) AS revenue
       FROM orders
       WHERE cafe_id = $1 AND DATE(created_at) BETWEEN $2 AND $3
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [req.cafeId, startDate, endDate]
    ),

    // Order type breakdown
    db.query(
      `SELECT order_type, COUNT(*) AS count
       FROM orders
       WHERE cafe_id = $1
         AND DATE(created_at) BETWEEN $2 AND $3
         AND status != 'cancelled'
       GROUP BY order_type`,
      [req.cafeId, startDate, endDate]
    ),

    // Table turn time — avg minutes from order placed to paid (dine-in only)
    db.query(
      `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60))::int AS avg_turn_mins,
              COUNT(*) AS paid_dine_in_orders
       FROM orders
       WHERE cafe_id = $1 AND status = 'paid' AND order_type = 'dine-in'
         AND DATE(created_at) BETWEEN $2 AND $3`,
      [req.cafeId, startDate, endDate]
    ),

    // Peak hours — orders by hour of day
    db.query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
              COUNT(*) AS order_count
       FROM orders
       WHERE cafe_id = $1 AND status != 'cancelled'
         AND DATE(created_at) BETWEEN $2 AND $3
       GROUP BY hour
       ORDER BY hour ASC`,
      [req.cafeId, startDate, endDate]
    ),

    // Repeat customers — by phone number
    db.query(
      `SELECT COUNT(*) AS total_customers,
              COUNT(*) FILTER (WHERE order_count > 1) AS repeat_customers
       FROM (
         SELECT customer_phone, COUNT(*) AS order_count
         FROM orders
         WHERE cafe_id = $1 AND status = 'paid' AND customer_phone IS NOT NULL
           AND DATE(created_at) BETWEEN $2 AND $3
         GROUP BY customer_phone
       ) sub`,
      [req.cafeId, startDate, endDate]
    ),

    // Revenue by category
    db.query(
      `SELECT COALESCE(c.name, 'Uncategorized') AS category,
              SUM(oi.quantity) AS total_qty,
              COALESCE(SUM(oi.subtotal) FILTER (WHERE o.status = 'paid'), 0) AS revenue
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
       LEFT JOIN categories c ON mi.category_id = c.id
       WHERE o.cafe_id = $1
         AND DATE(o.created_at) BETWEEN $2 AND $3
         AND o.status != 'cancelled'
       GROUP BY COALESCE(c.name, 'Uncategorized')
       ORDER BY revenue DESC`,
      [req.cafeId, startDate, endDate]
    ),
  ]);

  const totalRevenue     = parseFloat(summaryRes.rows[0].total_revenue);
  const totalTips        = parseFloat(summaryRes.rows[0].total_tips);
  const totalDelivery    = parseFloat(summaryRes.rows[0].total_delivery_fees);
  const totalExpenses    = parseFloat(expensesRes.rows[0].total_expenses);
  const foodRevenue      = parseFloat((totalRevenue - totalTips - totalDelivery).toFixed(2));

  ok(res, {
    period,
    startDate,
    endDate,
    summary: {
      total_orders:        parseInt(summaryRes.rows[0].total_orders),
      cancelled_orders:    parseInt(summaryRes.rows[0].cancelled_orders),
      paid_orders:         parseInt(summaryRes.rows[0].paid_orders),
      total_revenue:       totalRevenue,
      food_revenue:        foodRevenue,
      total_tips:          totalTips,
      total_delivery_fees: totalDelivery,
      total_expenses:      totalExpenses,
      profit:              parseFloat((totalRevenue - totalExpenses).toFixed(2)),
    },
    topItems:            topItemsRes.rows,
    dailyBreakdown:      dailyRes.rows,
    orderTypeBreakdown:  orderTypeRes.rows,
    categoryBreakdown:   categoryRes.rows,
    expenses:            expensesRes.rows[0].expense_list || [],
    tableTurn: {
      avg_turn_mins:       tableTurnRes.rows[0]?.avg_turn_mins ?? null,
      paid_dine_in_orders: parseInt(tableTurnRes.rows[0]?.paid_dine_in_orders ?? 0),
    },
    peakHours:           peakHoursRes.rows,
    repeatCustomers: {
      total:   parseInt(repeatRes.rows[0]?.total_customers ?? 0),
      repeat:  parseInt(repeatRes.rows[0]?.repeat_customers ?? 0),
    },
  });
});

// Owner: export orders for date range as CSV
exports.exportOrdersCSV = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const startDate = from || today;
  const endDate   = to   || today;

  const result = await db.query(
    `SELECT
       COALESCE(o.daily_order_number, o.order_number) AS token,
       o.order_type,
       o.customer_name,
       o.customer_phone,
       o.table_number,
       o.status,
       o.total_amount,
       o.discount_amount,
       o.tip_amount,
       o.final_amount,
       o.notes,
       TO_CHAR(o.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS created_at
     FROM orders o
     WHERE o.cafe_id = $1
       AND DATE(o.created_at) BETWEEN $2 AND $3
     ORDER BY o.created_at DESC`,
    [req.cafeId, startDate, endDate]
  );

  const headers = [
    'Token','Type','Customer','Phone','Table','Status',
    'Subtotal','Discount','Tip','Total','Notes','Date'
  ];
  const rows = result.rows.map((r) => [
    r.token, r.order_type, `"${r.customer_name}"`, r.customer_phone || '',
    `"${r.table_number}"`, r.status,
    r.total_amount, r.discount_amount || 0, r.tip_amount || 0, r.final_amount,
    `"${(r.notes || '').replace(/"/g, "'")}"`, r.created_at,
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="orders-${startDate}-to-${endDate}.csv"`);
  res.send(csv);
});
