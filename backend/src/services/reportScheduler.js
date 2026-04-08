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
  const [statsRes, topItemsRes, ratingRes, hourlyRes] = await Promise.all([
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
  ]);

  const stats = statsRes.rows[0];
  const topItems = topItemsRes.rows;
  const rating = ratingRes.rows[0];
  const peakHour = hourlyRes.rows[0];

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

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:24px">
        <a href="${process.env.CLIENT_URL || 'https://dine-verse.com'}/owner/analytics"
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

  logger.info('[Report] Daily report scheduler started (fires at 08:00 IST)');
};
