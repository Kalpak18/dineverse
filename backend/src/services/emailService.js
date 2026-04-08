/**
 * Email service using Brevo HTTP API (not SMTP).
 * Render blocks outbound SMTP ports (587/465), but HTTP (443) always works.
 * Free tier: 300 emails/day — no credit card needed.
 *
 * Required env var: BREVO_API_KEY
 * Get it: app.brevo.com → SMTP & API → API Keys → Generate
 */
const https = require('https');
const logger = require('../utils/logger');

const SENDER_NAME  = 'DineVerse';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || process.env.SMTP_FROM?.match(/<(.+)>/)?.[1] || 'noreply@dine-verse.com';

function brevoSend(to, subject, html) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      return reject(new Error('BREVO_API_KEY is not set. Add it in Render → Environment.'));
    }

    const body = JSON.stringify({
      sender:      { name: SENDER_NAME, email: SENDER_EMAIL },
      to:          [{ email: to }],
      subject,
      htmlContent: html,
    });

    const req = https.request({
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'api-key':       apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Brevo API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.sendOtpEmail = async (toEmail, otp) => {
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#f97316;margin-bottom:8px">Verify your email</h2>
      <p style="color:#374151;margin-bottom:24px">Use the code below to complete your DineVerse café registration.</p>
      <div style="background:#fff7ed;border:2px solid #fdba74;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
        <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#c2410c">${otp}</span>
      </div>
      <p style="color:#6b7280;font-size:13px">This code expires in <strong>10 minutes</strong>. If you didn't request this, ignore this email.</p>
    </div>`;
  try {
    await brevoSend(toEmail, 'Your DineVerse verification code', html);
    logger.info('OTP email sent to %s', toEmail);
  } catch (err) {
    logger.error('OTP email failed: %s', err.message);
    throw err;
  }
};

exports.sendPasswordResetEmail = async (toEmail, otp) => {
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#f97316;margin-bottom:8px">Reset your password</h2>
      <p style="color:#374151;margin-bottom:24px">Use the code below to reset your DineVerse password. Valid for <strong>10 minutes</strong>.</p>
      <div style="background:#fff7ed;border:2px solid #fdba74;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
        <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#c2410c">${otp}</span>
      </div>
      <p style="color:#6b7280;font-size:13px">If you didn't request a password reset, ignore this email.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
      <p style="color:#9ca3af;font-size:12px">DineVerse — Café Ordering Platform</p>
    </div>`;
  try {
    await brevoSend(toEmail, 'Reset your DineVerse password', html);
    logger.info('Password reset email sent to %s', toEmail);
  } catch (err) {
    logger.error('Password reset email failed: %s', err.message);
    throw new Error('Failed to send password reset email. Please try again.');
  }
};

exports.sendBroadcastEmail = async (toEmail, subject, htmlBody) => {
  try {
    await brevoSend(toEmail, subject, htmlBody);
  } catch (err) {
    logger.error('Broadcast email failed for %s: %s', toEmail, err.message);
    throw new Error(`Failed to send broadcast email: ${err.message}`);
  }
};
