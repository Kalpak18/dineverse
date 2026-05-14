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

// ── Rider welcome (self-registration) ────────────────────────────────────────
exports.sendRiderWelcomeEmail = async (toEmail, riderName) => {
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#ffffff">
      <div style="text-align:center;margin-bottom:28px">
        <div style="display:inline-block;background:#f97316;border-radius:16px;padding:14px 20px;font-size:32px">🛵</div>
        <h1 style="margin:16px 0 4px;font-size:22px;font-weight:800;color:#111827">Welcome to DineVerse Rider!</h1>
        <p style="color:#6b7280;font-size:14px;margin:0">Hey ${riderName}, you're all set to start delivering.</p>
      </div>

      <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:14px;padding:20px 24px;margin-bottom:24px">
        <h2 style="margin:0 0 12px;font-size:15px;font-weight:700;color:#c2410c">How it works</h2>
        <div style="space-y:8px">
          <p style="margin:0 0 8px;font-size:13px;color:#374151">
            <strong>1. Set your location</strong> — Open your profile and pin your base location. Orders within your chosen radius (up to 10 km) will appear.
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#374151">
            <strong>2. Go online</strong> — Toggle yourself online from the dashboard when you're ready to accept deliveries.
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#374151">
            <strong>3. Accept nearby orders</strong> — Browse pending orders from cafés near you and tap Accept to claim one.
          </p>
          <p style="margin:0;font-size:13px;color:#374151">
            <strong>4. Deliver &amp; earn</strong> — Complete deliveries to build your earnings history.
          </p>
        </div>
      </div>

      <div style="text-align:center;margin-bottom:28px">
        <a href="https://www.dine-verse.com/rider/jobs"
           style="display:inline-block;background:#f97316;color:#ffffff;font-weight:700;font-size:14px;padding:14px 32px;border-radius:12px;text-decoration:none">
          Open Rider Dashboard →
        </a>
      </div>

      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">
        DineVerse · <a href="https://www.dine-verse.com" style="color:#f97316;text-decoration:none">dine-verse.com</a>
      </p>
    </div>`;
  try {
    await brevoSend(toEmail, 'Welcome to DineVerse Rider 🛵', html);
    logger.info('Rider welcome email sent to %s', toEmail);
  } catch (err) {
    logger.error('Rider welcome email failed for %s: %s', toEmail, err.message);
    // non-fatal — registration still succeeds
  }
};

// ── Owner invite to rider ─────────────────────────────────────────────────────
exports.sendRiderInviteEmail = async (toEmail, riderName, cafeName, ownerName) => {
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#ffffff">
      <div style="text-align:center;margin-bottom:28px">
        <div style="display:inline-block;background:#f97316;border-radius:16px;padding:14px 20px;font-size:32px">🛵</div>
        <h1 style="margin:16px 0 4px;font-size:22px;font-weight:800;color:#111827">You've been invited!</h1>
        <p style="color:#6b7280;font-size:14px;margin:0">
          ${ownerName ? `<strong>${ownerName}</strong> from` : ''} <strong>${cafeName}</strong> has added you as a delivery rider on DineVerse.
        </p>
      </div>

      <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:14px;padding:20px 24px;margin-bottom:24px">
        <p style="margin:0 0 10px;font-size:13px;color:#374151">
          To start accepting deliveries from <strong>${cafeName}</strong>:
        </p>
        <ol style="margin:0;padding-left:20px;font-size:13px;color:#374151;line-height:1.8">
          <li>Open the DineVerse Rider app at <strong>dine-verse.com/rider/login</strong></li>
          <li>Enter <strong>${toEmail}</strong></li>
          <li>Enter the 6-digit code sent to your email</li>
          <li>You're in — deliveries from ${cafeName} will appear in your dashboard</li>
        </ol>
      </div>

      <div style="text-align:center;margin-bottom:28px">
        <a href="https://www.dine-verse.com/rider/login"
           style="display:inline-block;background:#f97316;color:#ffffff;font-weight:700;font-size:14px;padding:14px 32px;border-radius:12px;text-decoration:none">
          Log in to Rider App →
        </a>
      </div>

      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">
        If you didn't expect this, you can ignore it. · DineVerse
      </p>
    </div>`;
  try {
    await brevoSend(toEmail, `${cafeName} invited you as a delivery rider on DineVerse`, html);
    logger.info('Rider invite email sent to %s for cafe %s', toEmail, cafeName);
  } catch (err) {
    logger.error('Rider invite email failed for %s: %s', toEmail, err.message);
  }
};

// Raw send — used internally by notificationService for alert emails
exports.brevoSendRaw = brevoSend;
