/**
 * notificationService.js
 *
 * Single entry-point for every owner alert:
 *   1. Persists the notification in the DB  (survives page refresh / reconnect)
 *   2. Emits a real-time socket event to the owner's room
 *   3. Optionally sends an email alert (fire-and-forget, no throw)
 *
 * Usage:
 *   await notify(io, cafeId, cafeEmail, {
 *     type:   'new_order',
 *     title:  'New Order #42',
 *     body:   'Table 3 — 3 items — ₹580',
 *     refId:  orderId,         // optional
 *     email:  true,            // send email alert? default false
 *   });
 */

const db          = require('../config/database');
const { brevoSend } = require('./emailService');
const logger      = require('../utils/logger');

// ── Email rate-limit: one alert email per café per 5 minutes ────
const emailCooldown = new Map(); // cafeId → lastSentMs
const EMAIL_GAP_MS  = 5 * 60 * 1000;

async function notify(io, cafeId, cafeEmail, { type, title, body, refId, email = false }) {
  // 1. Persist in DB
  let notifId = null;
  try {
    const result = await db.query(
      `INSERT INTO notifications (cafe_id, type, title, body, ref_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [cafeId, type, title, body || null, refId || null]
    );
    notifId = result.rows[0].id;
  } catch (err) {
    // Table may not exist yet (migration not run) — log and continue
    logger.warn('[notify] DB insert failed: %s', err.message);
  }

  // 2. Real-time socket push to owner's room
  if (io) {
    io.to(`cafe:${cafeId}`).emit('notification', {
      id: notifId,
      type,
      title,
      body: body || null,
      ref_id: refId || null,
      is_read: false,
      created_at: new Date().toISOString(),
    });
  }

  // 3. Optional email alert with cooldown
  if (email && cafeEmail) {
    const last = emailCooldown.get(cafeId) || 0;
    const now  = Date.now();
    if (now - last > EMAIL_GAP_MS) {
      emailCooldown.set(cafeId, now);
      sendAlertEmail(cafeEmail, title, body).catch((err) =>
        logger.warn('[notify] email failed for café %s: %s', cafeId, err.message)
      );
    }
  }
}

async function sendAlertEmail(to, title, body) {
  // Import here to avoid circular deps at module load time
  const { brevoSendRaw } = require('./emailService');
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#fff">
      <div style="background:#f97316;padding:16px 24px;border-radius:12px 12px 0 0">
        <h2 style="color:#fff;margin:0;font-size:18px">⚡ DineVerse Alert</h2>
      </div>
      <div style="border:1px solid #fde8d8;border-top:none;border-radius:0 0 12px 12px;padding:20px 24px">
        <h3 style="color:#0f1535;margin:0 0 8px">${escHtml(title)}</h3>
        ${body ? `<p style="color:#555;margin:0 0 16px;font-size:14px">${escHtml(body)}</p>` : ''}
        <a href="${(process.env.CLIENT_URL || 'https://dine-verse.com').split(',')[0].trim()}/owner/orders"
           style="display:inline-block;background:#f97316;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
          Open Dashboard →
        </a>
        <p style="color:#aaa;font-size:11px;margin:16px 0 0">
          You're getting this because you have DineVerse email alerts enabled.
          Visit your dashboard to manage alert preferences.
        </p>
      </div>
    </div>`;

  await brevoSendRaw(to, `DineVerse: ${title}`, html);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { notify };
