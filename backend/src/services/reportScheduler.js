/**
 * Morning Business Report — sent daily at 8:00 AM IST (02:30 UTC).
 * Sends yesterday's summary to every active café that had orders.
 */
const cron = require('node-cron');
const https = require('https');
const db = require('../config/database');
const logger = require('../utils/logger');

function brevoSend(to, subject, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      sender:      { name: 'DineVerse', email: process.env.BREVO_SENDER_EMAIL || 'noreply@dine-verse.com' },
      to:          [{ email: to }],
      subject,
      htmlContent: html,
    });
    const req = https.request({
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Accept':         'application/json',
        'api-key':        process.env.BREVO_API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => res.statusCode < 300 ? resolve() : reject(new Error(`Brevo ${res.statusCode}: ${data}`)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const STAR = '★';
const EMPTY_STAR = '☆';
function stars(n) {
  const r = Math.round(n);
  return STAR.repeat(r) + EMPTY_STAR.repeat(5 - r);
}

async function sendDailyReports() {
  logger.info('[Report] Running daily report job');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10); // YYYY-MM-DD

  // Fetch all active, non-expired cafés that had at least 1 order yesterday
  const { rows: cafes } = await db.query(
    `SELECT c.id, c.name, c.email, c.slug
     FROM cafes c
     WHERE c.is_active = true
       AND c.plan_expiry_date > NOW()
       AND EXISTS (
         SELECT 1 FROM orders o
         WHERE o.cafe_id = c.id
           AND DATE(o.created_at) = $1
           AND o.status != 'cancelled'
       )`,
    [dateStr]
  );

  logger.info('[Report] Sending reports to %d cafés for %s', cafes.length, dateStr);

  for (const cafe of cafes) {
    try {
      await sendReportForCafe(cafe, dateStr);
    } catch (err) {
      logger.error('[Report] Failed for %s: %s', cafe.slug, err.message);
    }
  }
}

async function sendReportForCafe(cafe, dateStr) {
  const [statsRes, topItemsRes, ratingRes, hourlyRes, actionRes] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'cancelled') AS total_orders,
         COUNT(*) FILTER (WHERE status = 'paid') AS paid_orders,
         COALESCE(SUM(final_amount) FILTER (WHERE status = 'paid'), 0) AS revenue,
         COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0) AS gross_revenue,
         COUNT(*) FILTER (WHERE order_type = 'dine-in' AND status != 'cancelled') AS dine_in,
         COUNT(*) FILTER (WHERE order_type = 'takeaway' AND status != 'cancelled') AS takeaway
       FROM orders
       WHERE cafe_id = $1 AND DATE(created_at) = $2`,
      [cafe.id, dateStr]
    ),
    db.query(
      `SELECT oi.item_name, SUM(oi.quantity) AS qty, SUM(oi.subtotal) AS revenue
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.cafe_id = $1 AND DATE(o.created_at) = $2 AND o.status = 'paid'
       GROUP BY oi.item_name
       ORDER BY qty DESC LIMIT 5`,
      [cafe.id, dateStr]
    ),
    db.query(
      `SELECT ROUND(AVG(rating)::numeric,1) AS avg, COUNT(*) AS total
       FROM order_ratings
       WHERE cafe_id = $1 AND DATE(created_at) = $2`,
      [cafe.id, dateStr]
    ),
    db.query(
      `SELECT EXTRACT(HOUR FROM created_at) AS hour, COUNT(*) AS orders
       FROM orders
       WHERE cafe_id = $1 AND DATE(created_at) = $2 AND status != 'cancelled'
       GROUP BY hour ORDER BY orders DESC LIMIT 1`,
      [cafe.id, dateStr]
    ),
    // Action items: pending orders + unconfirmed reservations + low/zero-stock items
    Promise.all([
      db.query(
        `SELECT COUNT(*) AS count FROM orders
         WHERE cafe_id = $1 AND status = 'pending'`,
        [cafe.id]
      ),
      db.query(
        `SELECT COUNT(*) AS count FROM reservations
         WHERE cafe_id = $1 AND status = 'pending'
           AND reserved_date >= CURRENT_DATE`,
        [cafe.id]
      ).catch(() => ({ rows: [{ count: 0 }] })), // table may not exist on older DBs
      db.query(
        `SELECT name, stock_quantity FROM menu_items
         WHERE cafe_id = $1 AND track_stock = true
           AND stock_quantity IS NOT NULL AND stock_quantity <= 5
         ORDER BY stock_quantity ASC LIMIT 5`,
        [cafe.id]
      ),
    ]),
  ]);

  const stats = statsRes.rows[0];
  const topItems = topItemsRes.rows;
  const rating = ratingRes.rows[0];
  const peakHour = hourlyRes.rows[0];
  const [pendingOrdersRes, pendingResRes, lowStockRes] = actionRes;
  const pendingOrders = parseInt(pendingOrdersRes.rows[0].count, 10);
  const pendingReservations = parseInt(pendingResRes.rows[0].count, 10);
  const lowStockItems = lowStockRes.rows;

  const revenue = parseFloat(stats.revenue || 0);
  const formattedDate = new Date(dateStr).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const peakHourStr = peakHour
    ? `${peakHour.hour}:00 – ${parseInt(peakHour.hour) + 1}:00 (${peakHour.orders} orders)`
    : 'N/A';

  const topItemsHtml = topItems.length
    ? topItems.map((item, i) => `
        <tr>
          <td style="padding:6px 12px;color:#6b7280">${i + 1}.</td>
          <td style="padding:6px 12px;font-weight:600;color:#111827">${item.item_name}</td>
          <td style="padding:6px 12px;color:#374151;text-align:right">${item.qty} sold</td>
          <td style="padding:6px 12px;color:#374151;text-align:right">₹${parseFloat(item.revenue).toFixed(0)}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" style="padding:10px 12px;color:#9ca3af;text-align:center">No data</td></tr>`;

  const ratingHtml = rating.total > 0
    ? `<p style="font-size:28px;margin:0;letter-spacing:2px;color:#f59e0b">${stars(parseFloat(rating.avg))}</p>
       <p style="font-size:13px;color:#6b7280;margin:4px 0 0">${rating.avg} / 5 from ${rating.total} review${rating.total !== '1' ? 's' : ''}</p>`
    : `<p style="font-size:13px;color:#9ca3af">No ratings yet</p>`;

  const html = `
  <!DOCTYPE html>
  <html><head><meta charset="UTF-8"></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px">
    <div style="max-width:540px;margin:0 auto">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#f97316,#ea580c);border-radius:16px;padding:28px 32px;margin-bottom:20px;color:white">
        <p style="margin:0 0 4px;font-size:13px;opacity:0.85">Daily Report · ${formattedDate}</p>
        <h1 style="margin:0;font-size:24px;font-weight:800">${cafe.name}</h1>
        <p style="margin:8px 0 0;font-size:13px;opacity:0.75">Good morning! Here's how yesterday went.</p>
      </div>

      <!-- Revenue + Orders -->
      <div style="display:flex;gap:12px;margin-bottom:16px">
        <div style="flex:1;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;text-align:center">
          <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Revenue</p>
          <p style="margin:6px 0 0;font-size:28px;font-weight:800;color:#111827">₹${revenue.toFixed(0)}</p>
        </div>
        <div style="flex:1;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;text-align:center">
          <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Orders</p>
          <p style="margin:6px 0 0;font-size:28px;font-weight:800;color:#111827">${stats.paid_orders}</p>
        </div>
        <div style="flex:1;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;text-align:center">
          <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Avg. Bill</p>
          <p style="margin:6px 0 0;font-size:28px;font-weight:800;color:#111827">
            ₹${stats.paid_orders > 0 ? (revenue / stats.paid_orders).toFixed(0) : 0}
          </p>
        </div>
      </div>

      <!-- Top Items -->
      <div style="background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;margin-bottom:16px">
        <h2 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px">
          🍽️ Top Selling Items
        </h2>
        <table style="width:100%;border-collapse:collapse">
          ${topItemsHtml}
        </table>
      </div>

      <!-- Peak hour + Ratings -->
      <div style="display:flex;gap:12px;margin-bottom:20px">
        <div style="flex:1;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;text-align:center">
          <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Peak Hour</p>
          <p style="margin:8px 0 0;font-size:14px;font-weight:700;color:#111827">${peakHourStr}</p>
        </div>
        <div style="flex:1;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;text-align:center">
          <p style="margin:0 0 6px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Ratings</p>
          ${ratingHtml}
        </div>
      </div>

      <!-- Order type breakdown -->
      <div style="background:white;border-radius:12px;padding:16px 20px;border:1px solid #e5e7eb;margin-bottom:20px;display:flex;justify-content:space-around">
        <div style="text-align:center">
          <p style="font-size:20px;margin:0">🍽️</p>
          <p style="margin:4px 0 0;font-weight:700;font-size:16px;color:#111827">${stats.dine_in}</p>
          <p style="margin:2px 0 0;font-size:12px;color:#6b7280">Dine-in</p>
        </div>
        <div style="text-align:center">
          <p style="font-size:20px;margin:0">🥡</p>
          <p style="margin:4px 0 0;font-weight:700;font-size:16px;color:#111827">${stats.takeaway}</p>
          <p style="margin:2px 0 0;font-size:12px;color:#6b7280">Takeaway</p>
        </div>
      </div>

      ${(pendingOrders > 0 || pendingReservations > 0 || lowStockItems.length > 0) ? `
      <!-- Action Required -->
      <div style="background:#fff7ed;border:2px solid #fb923c;border-radius:12px;padding:20px;margin-bottom:20px">
        <h2 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.5px">
          ⚡ Action Required
        </h2>
        ${pendingOrders > 0 ? `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #fed7aa">
          <div>
            <p style="margin:0;font-weight:600;color:#111827;font-size:13px">Unconfirmed Orders</p>
            <p style="margin:2px 0 0;font-size:12px;color:#6b7280">${pendingOrders} order${pendingOrders !== 1 ? 's' : ''} waiting for confirmation</p>
          </div>
          <a href="${(process.env.CLIENT_URL || 'https://dine-verse.com').split(',')[0].trim()}/owner/orders"
             style="background:#f97316;color:white;font-size:12px;font-weight:700;padding:8px 16px;border-radius:8px;text-decoration:none">
            Confirm →
          </a>
        </div>` : ''}
        ${pendingReservations > 0 ? `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;${lowStockItems.length > 0 ? 'border-bottom:1px solid #fed7aa;' : ''}">
          <div>
            <p style="margin:0;font-weight:600;color:#111827;font-size:13px">Unconfirmed Reservations</p>
            <p style="margin:2px 0 0;font-size:12px;color:#6b7280">${pendingReservations} reservation${pendingReservations !== 1 ? 's' : ''} need your response</p>
          </div>
          <a href="${(process.env.CLIENT_URL || 'https://dine-verse.com').split(',')[0].trim()}/owner/reservations"
             style="background:#f97316;color:white;font-size:12px;font-weight:700;padding:8px 16px;border-radius:8px;text-decoration:none">
            Review →
          </a>
        </div>` : ''}
        ${lowStockItems.length > 0 ? `
        <div style="padding:10px 0 0">
          <p style="margin:0 0 6px;font-weight:600;color:#111827;font-size:13px">Low / Zero Stock</p>
          ${lowStockItems.map((item) => `
            <div style="display:flex;justify-content:space-between;padding:3px 0">
              <span style="font-size:12px;color:#374151">${item.name}</span>
              <span style="font-size:12px;font-weight:700;color:${item.stock_quantity <= 0 ? '#dc2626' : '#d97706'}">${item.stock_quantity <= 0 ? 'Sold out' : `${item.stock_quantity} left`}</span>
            </div>`).join('')}
          <a href="${(process.env.CLIENT_URL || 'https://dine-verse.com').split(',')[0].trim()}/owner/inventory"
             style="display:inline-block;margin-top:8px;font-size:12px;color:#f97316;text-decoration:none;font-weight:600">
            Restock items →
          </a>
        </div>` : ''}
      </div>` : ''}

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:24px">
        <a href="${(process.env.CLIENT_URL || 'https://dine-verse.com').split(',')[0].trim()}/owner/analytics"
           style="display:inline-block;background:#f97316;color:white;font-weight:700;font-size:14px;padding:12px 28px;border-radius:10px;text-decoration:none">
          View Full Analytics →
        </a>
      </div>

      <p style="text-align:center;font-size:12px;color:#d1d5db">
        DineVerse · You're receiving this because you run ${cafe.name} on DineVerse.
      </p>
    </div>
  </body></html>`;

  await brevoSend(cafe.email, `☀️ ${cafe.name} — Yesterday's Report (${formattedDate})`, html);

  logger.info('[Report] Sent to %s (%s) — Revenue: ₹%d, Orders: %s', cafe.name, cafe.email, revenue, stats.paid_orders);
}

async function sendExpiryReminders() {
  logger.info('[Expiry] Running subscription expiry reminder job');
  const { rows: cafes } = await db.query(
    `SELECT id, name, email, plan_tier, plan_expiry_date
     FROM cafes
     WHERE is_active = true
       AND plan_expiry_date IS NOT NULL
       AND DATE(plan_expiry_date) = CURRENT_DATE + INTERVAL '7 days'`
  );
  logger.info('[Expiry] Sending reminders to %d café(s)', cafes.length);
  for (const cafe of cafes) {
    try {
      const planLabel = cafe.plan_tier === 'premium' ? 'Kitchen Pro' : 'Essential';
      const expiryStr = new Date(cafe.plan_expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      const billingUrl = `${(process.env.CLIENT_URL || 'https://dine-verse.com').split(',')[0].trim()}/owner/billing`;
      const html = `
      <!DOCTYPE html>
      <html><head><meta charset="UTF-8"></head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px">
        <div style="max-width:500px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:16px;padding:28px 32px;margin-bottom:20px;color:white;text-align:center">
            <p style="font-size:40px;margin:0 0 8px">⚠️</p>
            <h1 style="margin:0;font-size:22px;font-weight:800">Your subscription expires in 7 days</h1>
            <p style="margin:8px 0 0;font-size:14px;opacity:0.85">${cafe.name}</p>
          </div>
          <div style="background:white;border-radius:12px;padding:24px;border:1px solid #e5e7eb;margin-bottom:16px;text-align:center">
            <p style="margin:0 0 6px;font-size:13px;color:#6b7280">Current plan</p>
            <p style="margin:0;font-size:24px;font-weight:800;color:#111827">${planLabel}</p>
            <p style="margin:8px 0 0;font-size:14px;color:#dc2626;font-weight:600">Expires: ${expiryStr}</p>
          </div>
          <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:12px;padding:16px 20px;margin-bottom:20px">
            <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6">
              After expiry, your menu will be <strong>hidden from customers</strong> and you won't be able to accept new orders until you renew. Renew now to avoid any interruption.
            </p>
          </div>
          <div style="text-align:center;margin-bottom:24px">
            <a href="${billingUrl}"
               style="display:inline-block;background:#f97316;color:white;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none">
              Renew Now →
            </a>
          </div>
          <p style="text-align:center;font-size:12px;color:#d1d5db">
            DineVerse · ${cafe.name}
          </p>
        </div>
      </body></html>`;
      await brevoSend(cafe.email, `⚠️ Your DineVerse subscription expires in 7 days`, html);
      logger.info('[Expiry] Reminder sent to %s (%s)', cafe.name, cafe.email);
    } catch (err) {
      logger.error('[Expiry] Failed for %s: %s', cafe.name, err.message);
    }
  }
}

async function autoCancelExpiredReservations() {
  logger.info('[Reservation] Running auto-cancel expired reservations job');

  const result = await db.query(
    `UPDATE reservations
     SET status = 'cancelled', updated_at = NOW()
     WHERE status = 'pending'
       AND (reserved_date + reserved_time) < NOW()
     RETURNING id, cafe_id, customer_name, reserved_date, reserved_time`
  );

  if (result.rows.length > 0) {
    logger.info('[Reservation] Auto-cancelled %d expired reservations', result.rows.length);

    // Group by cafe_id and notify owners
    const byCafe = {};
    result.rows.forEach((res) => {
      if (!byCafe[res.cafe_id]) byCafe[res.cafe_id] = [];
      byCafe[res.cafe_id].push(res);
    });

    for (const [cafeId, reservations] of Object.entries(byCafe)) {
      try {
        const cafeRes = await db.query('SELECT email FROM cafes WHERE id = $1', [cafeId]);
        if (cafeRes.rows.length > 0) {
          const cafeEmail = cafeRes.rows[0].email;
          const count = reservations.length;
          const firstRes = reservations[0];

          // Import notify function (it needs to be available in this scope)
          const { notify } = require('./notificationService');

          notify(null, cafeId, cafeEmail, {
            type:  'reservation_auto_cancelled',
            title: `${count} reservation${count > 1 ? 's' : ''} auto-cancelled`,
            body:  `Expired reservations from ${firstRes.reserved_date} were automatically cancelled`,
            refId: firstRes.id,
            email: true,
          }).catch(() => {});
        }
      } catch (err) {
        logger.error('[Reservation] Failed to notify cafe %s: %s', cafeId, err.message);
      }
    }
  } else {
    logger.info('[Reservation] No expired reservations to cancel');
  }
}

module.exports = function initReportScheduler() {
  if (!process.env.BREVO_API_KEY) {
    logger.warn('[Report] BREVO_API_KEY not set — skipping report scheduler');
    return;
  }
  // Run at 08:00 AM IST = 02:30 UTC
  cron.schedule('30 2 * * *', () => {
    sendDailyReports().catch((err) =>
      logger.error('[Report] Scheduler error: %s', err.message)
    );
  }, { timezone: 'UTC' });

  // Run expiry reminders at 09:00 AM IST = 03:30 UTC
  cron.schedule('30 3 * * *', () => {
    sendExpiryReminders().catch((err) =>
      logger.error('[Expiry] Scheduler error: %s', err.message)
    );
  }, { timezone: 'UTC' });

  // Run reservation auto-cancel every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    autoCancelExpiredReservations().catch((err) =>
      logger.error('[Reservation] Auto-cancel error: %s', err.message)
    );
  }, { timezone: 'UTC' });

  logger.info('[Report] Daily report + expiry reminder + reservation auto-cancel schedulers started');
};
